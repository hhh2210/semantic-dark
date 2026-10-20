import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import {lstat, mkdir, open, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import {
  V2_EXPOSURE_RECEIPT_SCHEMA,
  type V2ExposureBinding,
  type V2ExposureCompletion,
  type V2ExposureReceipt,
  type V2ExposureStorageOptions,
  type V2ExposureStore,
} from './exposure-types';
import {
  validateV2ExposureCompletion,
  validateV2ExposureReceipt,
  validateV2LogId,
  v2ExposureClaimId,
} from './exposure-validation';

declare const preparedExposureBrand: unique symbol;
export interface PreparedV2Exposure {
  readonly receipt: V2ExposureReceipt;
  readonly receiptPath: string;
  readonly receiptSha256: string;
  readonly completionPath: string;
  readonly metricPayloadPath: string;
  readonly logHandle: FileHandle;
  readonly store: V2ExposureStore;
  readonly [preparedExposureBrand]: true;
}
export interface V2EvidencePaths {
  claimsDirectory: string;
  completionsDirectory: string;
  logsDirectory: string;
  metricPayloadsDirectory: string;
  promotionDirectory: string;
}
export interface VerifiedV2ExposureEvidence {
  receipt: V2ExposureReceipt;
  completion: V2ExposureCompletion;
}
const stores = new WeakSet<object>();
const preparedExposures = new WeakSet<object>();
const productionStore = createStore(path.join(
  homedir(), 'scratch-data/semantic-dark-pairs'), 'production');
export function productionV2ExposureStore(): V2ExposureStore {
  return productionStore;
}
/** Explicitly unsafe-for-production seam. It returns a brand, never accepts a raw store object. */
export function createInternalV2ExposureTestStore(rootDirectory: string): V2ExposureStore {
  if (!path.isAbsolute(rootDirectory) || path.normalize(rootDirectory) !== rootDirectory) {
    throw new TypeError('internal test evidence root must be a normalized absolute path');
  }
  const relative = path.relative(productionStore.rootDirectory, rootDirectory);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('internal test evidence root must not overlap production evidence');
  }
  return createStore(rootDirectory, 'internal-test');
}
export function assertV2ExposureStore(store: V2ExposureStore): void {
  if (!stores.has(store)) throw new Error('V2 evidence requires a branded exposure store');
}
export function resolveV2EvidencePaths(
  store: V2ExposureStore = productionStore,
): V2EvidencePaths {
  assertV2ExposureStore(store);
  const exposure = path.join(store.rootDirectory, '.exposure-v2');
  return {claimsDirectory: path.join(exposure, 'claims'),
    completionsDirectory: path.join(exposure, 'completions'),
    logsDirectory: path.join(store.rootDirectory, 'logs'),
    metricPayloadsDirectory: path.join(exposure, 'metric-payloads'),
    promotionDirectory: path.join(exposure, 'promotion')};
}
/** Log identity is created first; the O_EXCL claim permanently consumes the primary pair. */
export async function prepareV2Exposure(
  binding: V2ExposureBinding,
  options: V2ExposureStorageOptions = {},
): Promise<PreparedV2Exposure> {
  const {assertContractDerivedV2ExposureBinding} = await import('./exposure-contract');
  assertContractDerivedV2ExposureBinding(binding);
  const store = options.store ?? productionStore;
  if (store.kind === 'production' && [options.now, options.pid, options.logIdFactory]
    .some((value) => value !== undefined)) {
    throw new Error('production exposure evidence forbids test-only clock, pid, or ID injection');
  }
  const paths = await ensureV2EvidencePaths(store);
  const claimId = v2ExposureClaimId(binding);
  const logId = validateV2LogId((options.logIdFactory ?? randomUUID)());
  const logPath = path.join(paths.logsDirectory, `${claimId}.${logId}.log`);
  const logHandle = await openExclusive(logPath, 0o600, true);
  try {
    await logHandle.chmod(0o600);
    await logHandle.sync();
    await syncDirectory(paths.logsDirectory);
    const receipt = validateV2ExposureReceipt({schema: V2_EXPOSURE_RECEIPT_SCHEMA,
      claimId, status: 'claimed-consumes-exposure', ...binding,
      log: {id: logId, path: logPath}, failureConsumesExposure: true,
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      pid: options.pid ?? process.pid});
    const receiptPath = path.join(paths.claimsDirectory, `${claimId}.json`);
    const receiptSha256 = await writeExclusiveJson(receiptPath, receipt, store);
    const prepared = Object.freeze({receipt, receiptPath, receiptSha256,
      completionPath: path.join(paths.completionsDirectory, `${claimId}.json`),
      metricPayloadPath: path.join(paths.metricPayloadsDirectory, `${claimId}.json`),
      logHandle, store}) as PreparedV2Exposure;
    preparedExposures.add(prepared);
    return prepared;
  } catch (error) {
    await makeHandleImmutable(logHandle).catch(() => undefined);
    await logHandle.close().catch(() => undefined);
    throw error;
  }
}
export function assertPreparedV2Exposure(value: PreparedV2Exposure): void {
  if (!preparedExposures.has(value)) {
    throw new Error('V2 completion requires the live prepared exposure capability');
  }
}
export async function persistV2ExposureCompletion(
  prepared: PreparedV2Exposure,
  value: unknown,
): Promise<V2ExposureCompletion> {
  assertPreparedV2Exposure(prepared);
  const completion = validateV2ExposureCompletion(value, prepared.receipt);
  if (completion.receiptSha256 !== prepared.receiptSha256) {
    throw new Error('completion receipt SHA-256 does not match claimed receipt bytes');
  }
  await writeExclusiveJson(prepared.completionPath, completion, prepared.store);
  return completion;
}
/** Derive all paths from claimId; caller-supplied evidence paths are never accepted. */
export async function verifyPersistedV2ExposureEvidence(
  claimId: string,
  store: V2ExposureStore = productionStore,
): Promise<VerifiedV2ExposureEvidence> {
  const persisted = await readPersistedV2ExposureReceipt(claimId, store, true);
  const paths = resolveV2EvidencePaths(store);
  const completionPath = path.join(paths.completionsDirectory, `${claimId}.json`);
  const completionBytes = await readImmutableFile(completionPath, store, [0o400]);
  const completion = validateV2ExposureCompletion(parseJson(completionBytes, 'completion'),
    persisted.receipt);
  assertCanonicalJson(completionBytes, completion, 'completion');
  const logPath = path.join(paths.logsDirectory,
    `${claimId}.${persisted.receipt.log.id}.log`);
  if (persisted.receipt.log.path !== logPath || completion.log.path !== logPath) {
    throw new Error('persisted v2 log path is not claim-derived');
  }
  const logBytes = await readImmutableFile(logPath, store, [0o400]);
  if (persisted.receiptSha256 !== completion.receiptSha256 ||
      logBytes.byteLength !== completion.log.byteLength ||
      sha256Bytes(logBytes) !== completion.log.sha256) {
    throw new Error('persisted v2 evidence hash/length chain is invalid');
  }
  return {receipt: persisted.receipt, completion};
}
export async function readPersistedV2ExposureReceipt(
  claimId: string,
  store: V2ExposureStore = productionStore,
  requireImmutableLog = false,
): Promise<{receipt: V2ExposureReceipt; receiptPath: string; receiptSha256: string}> {
  if (!/^[0-9a-f]{64}$/.test(claimId)) throw new TypeError('claimId is invalid');
  const paths = await ensureV2EvidencePaths(store);
  const receiptPath = path.join(paths.claimsDirectory, `${claimId}.json`);
  const bytes = await readImmutableFile(receiptPath, store, [0o400]);
  const receipt = validateV2ExposureReceipt(parseJson(bytes, 'receipt'));
  assertCanonicalJson(bytes, receipt, 'receipt');
  if (receipt.claimId !== claimId) throw new Error('receipt filename identity mismatch');
  const expectedLog = path.join(paths.logsDirectory, `${claimId}.${receipt.log.id}.log`);
  if (receipt.log.path !== expectedLog) throw new Error('receipt log path is not claim-derived');
  await assertSecureFile(expectedLog, store, requireImmutableLog ? [0o400] : [0o600, 0o400]);
  return {receipt, receiptPath, receiptSha256: sha256Bytes(bytes)};
}

export async function readV2MetricPayloadArtifact(
  prepared: PreparedV2Exposure,
): Promise<Buffer> {
  assertPreparedV2Exposure(prepared);
  return readImmutableFile(prepared.metricPayloadPath, prepared.store, [0o400]);
}

export async function verifyImmutableV2EvidenceFile(
  filePath: string, sha256: string, store: V2ExposureStore,
): Promise<Buffer> {
  const bytes = await readImmutableFile(filePath, store, [0o400]);
  if (sha256Bytes(bytes) !== sha256) throw new Error('immutable evidence file SHA-256 mismatch');
  return bytes;
}

export async function writeV2PromotionOnceMarker(
  store: V2ExposureStore, value: unknown,
): Promise<{path: string; sha256: string}> {
  const paths = await ensureV2EvidencePaths(store);
  const markerPath = path.join(paths.promotionDirectory, 'promotion-once.json');
  return {path: markerPath, sha256: await writeExclusiveJson(markerPath, value, store)};
}

export function v2PromotionOnceMarkerPath(store: V2ExposureStore): string {
  return path.join(resolveV2EvidencePaths(store).promotionDirectory, 'promotion-once.json');
}

async function ensureV2EvidencePaths(store: V2ExposureStore): Promise<V2EvidencePaths> {
  assertV2ExposureStore(store);
  await mkdir(store.rootDirectory, {recursive: true, mode: 0o700});
  await assertDirectory(store.rootDirectory, store, false);
  const paths = resolveV2EvidencePaths(store);
  const exposure = path.dirname(paths.claimsDirectory);
  for (const directory of [exposure, paths.claimsDirectory, paths.completionsDirectory,
    paths.logsDirectory, paths.metricPayloadsDirectory, paths.promotionDirectory]) {
    await mkdir(directory, {mode: 0o700}).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await assertDirectory(directory, store, true);
  }
  return paths;
}

async function assertDirectory(
  directory: string, store: V2ExposureStore, requirePrivate: boolean,
): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('evidence directory is not a real directory');
  assertOwner(info.uid);
  if (requirePrivate && (info.mode & 0o777) !== 0o700) throw new Error('evidence directory mode must be 0700');
  await assertRealContainment(directory, store);
}

async function readImmutableFile(
  filePath: string, store: V2ExposureStore, allowedModes: readonly number[],
): Promise<Buffer> {
  const before = await assertSecureFile(filePath, store, allowedModes);
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino ||
        !allowedModes.includes(after.mode & 0o777)) {
      throw new Error('evidence file changed during open');
    }
    assertOwner(after.uid);
    const bytes = await handle.readFile();
    const final = await handle.stat();
    if (after.dev !== final.dev || after.ino !== final.ino ||
        after.size !== final.size || bytes.byteLength !== final.size ||
        after.mtimeMs !== final.mtimeMs || after.ctimeMs !== final.ctimeMs) {
      throw new Error('evidence file changed while being read');
    }
    return bytes;
  } finally { await handle.close(); }
}

async function assertSecureFile(
  filePath: string, store: V2ExposureStore, allowedModes: readonly number[],
) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('evidence path is not a regular no-follow file');
  assertOwner(info.uid);
  if (!allowedModes.includes(info.mode & 0o777)) throw new Error('evidence file mode is invalid');
  await assertRealContainment(filePath, store);
  return info;
}

async function assertRealContainment(target: string, store: V2ExposureStore): Promise<void> {
  const [rootReal, targetReal] = await Promise.all([realpath(store.rootDirectory), realpath(target)]);
  const relative = path.relative(rootReal, targetReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('evidence path escapes its root');
}

async function writeExclusiveJson(
  filePath: string, value: unknown, store: V2ExposureStore,
): Promise<string> {
  await assertRealContainment(path.dirname(filePath), store);
  const bytes = serializeCanonicalJson(value);
  const handle = await openExclusive(filePath, 0o600);
  try { await handle.writeFile(bytes, 'utf8'); await makeHandleImmutable(handle); }
  finally { await handle.close(); }
  await syncDirectory(path.dirname(filePath));
  await assertSecureFile(filePath, store, [0o400]);
  return sha256Text(bytes);
}

function openExclusive(filePath: string, mode: number, readWrite = false): Promise<FileHandle> {
  return open(filePath, (readWrite ? constants.O_RDWR : constants.O_WRONLY) | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, mode);
}
async function makeHandleImmutable(handle: FileHandle): Promise<void> { await handle.chmod(0o400); await handle.sync(); }
async function syncDirectory(directory: string): Promise<void> { const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
function assertOwner(uid: number): void { if (process.getuid !== undefined && uid !== process.getuid()) throw new Error('evidence path owner mismatch'); }
function parseJson(bytes: Buffer, label: string): unknown { try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${label} is not valid JSON`); } }
function assertCanonicalJson(bytes: Buffer, value: unknown, label: string): void { if (bytes.toString('utf8') !== serializeCanonicalJson(value)) throw new Error(`${label} bytes are not canonical JSON`); }
function sha256Bytes(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function createStore(rootDirectory: string, kind: V2ExposureStore['kind']): V2ExposureStore { const store = Object.freeze({rootDirectory: path.resolve(rootDirectory), kind}) as V2ExposureStore; stores.add(store); return store; }

export type {V2ExposureBinding, V2ExposureCompletion, V2ExposureReceipt,
  V2ExposureStorageOptions, V2ExposureStore} from './exposure-types';
export {assertV2ExposureReceiptMatchesBinding, validateV2ExposureBinding,
  validateV2ExposureCompletion, validateV2ExposureReceipt,
  validateV2MetricPayloadCount, v2ExposureClaimId} from './exposure-validation';
