import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writable} from 'node:stream';

import {serializeCanonicalJson} from '../../artifacts';
import {
  assertPreparedV2Exposure,
  prepareV2Exposure,
  persistV2ExposureCompletion,
  readV2MetricPayloadArtifact,
  type PreparedV2Exposure,
  type V2ExposureBinding,
  type V2ExposureCompletion,
  type V2ExposureStorageOptions,
} from './exposure';
import {
  V2_EXPOSURE_COMPLETION_SCHEMA,
  type V2ExposureFailureKind,
  type V2SystemMetricPayloadCount,
} from './exposure-types';
import {
  validateV2MetricPayloadCountArtifact,
  v2MetricPayloadCountState,
} from './exposure-validation';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const FIXED_WORKER = path.join(REPO_ROOT, 'scripts/paired-theme-v2-confirmation-worker.ts');

interface WorkerCommand {
  command: string;
  args: readonly string[];
  cwd: string;
}

export interface V2ProcessEvidence {
  childPid: number | null;
  exitCode: number | null;
  signal: string | null;
}

/** Production surface: worker, cwd, env, count artifact, and evidence root are fixed. */
export async function runFixedV2ExposureWorker(
  binding: V2ExposureBinding,
): Promise<V2ExposureCompletion> {
  const info = await lstat(FIXED_WORKER);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('fixed v2 confirmation worker preflight failed');
  }
  return supervise(binding, {command: process.execPath,
    args: ['--import', 'tsx', FIXED_WORKER], cwd: REPO_ROOT}, {});
}

async function runV2ExposureWorkerForInternalTest(
  binding: V2ExposureBinding,
  worker: {command: string; args?: readonly string[]; cwd?: string},
  options: V2ExposureStorageOptions,
): Promise<V2ExposureCompletion> {
  if (typeof worker.command !== 'string' || worker.command.length === 0 ||
      (worker.args !== undefined && worker.args.some((item) => typeof item !== 'string'))) {
    throw new TypeError('internal test worker command is invalid');
  }
  return supervise(binding, {command: worker.command, args: [...(worker.args ?? [])],
    cwd: worker.cwd ?? REPO_ROOT}, options);
}

/** @internal Non-production seam; arbitrary workers still cannot inject count callbacks. */
export const __v2ExposureSupervisorTestSeam = Object.freeze({
  run: runV2ExposureWorkerForInternalTest,
});

async function supervise(
  binding: V2ExposureBinding,
  worker: WorkerCommand,
  options: V2ExposureStorageOptions,
): Promise<V2ExposureCompletion> {
  const prepared = await prepareV2Exposure(binding, options);
  assertPreparedV2Exposure(prepared);
  const writerState = createLogWriter(prepared);
  const failures = new Set<V2ExposureFailureKind>();
  let child: ChildProcess | undefined;
  let processEvidence: V2ProcessEvidence = {childPid: null, exitCode: null, signal: null};
  let counts = unavailableCounts(prepared);
  let log: Awaited<ReturnType<typeof finalizeLog>> | undefined;

  try {
    try {
      child = spawn(worker.command, [...worker.args], {cwd: worker.cwd,
        env: fixedWorkerEnvironment(prepared), stdio: ['ignore', 'pipe', 'pipe']});
      processEvidence = await captureChild(child, writerState.writer, failures);
    } catch (error) {
      failures.add('supervisor');
      safeLog(writerState.writer, supervisorLine('supervisor', error));
      killChild(child);
    }
    applyProcessFailures(processEvidence, failures);

    try {
      const bytes = await readV2MetricPayloadArtifact(prepared);
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      const artifact = validateV2MetricPayloadCountArtifact(parsed, prepared.receipt);
      if (bytes.toString('utf8') !== serializeCanonicalJson(artifact)) {
        throw new Error('metric payload count artifact bytes are not canonical JSON');
      }
      counts = artifact.systems;
    } catch (error) {
      safeLog(writerState.writer, supervisorLine('metric-payload-count', error));
    }
    const countState = v2MetricPayloadCountState(counts, prepared.receipt);
    if (!countState.valid) failures.add('metric-payload-count');
    log = await finalizeLog(prepared, writerState, failures);
    return await persistV2ExposureCompletion(prepared, completionRecord(
      prepared, processEvidence, counts, failures, log, options,
    ));
  } catch (error) {
    killChild(child);
    failures.add('supervisor');
    safeLog(writerState.writer, supervisorLine('supervisor-fatal', error));
    try {
      log ??= await finalizeLog(prepared, writerState, failures);
      return await persistV2ExposureCompletion(prepared, completionRecord(
        prepared, processEvidence, counts, failures, log, options,
      ));
    } catch (completionError) {
      throw new AggregateError([error, completionError],
        'V2 supervisor could not persist its best-effort failure completion');
    }
  }
}

function completionRecord(
  prepared: PreparedV2Exposure,
  processEvidence: V2ProcessEvidence,
  counts: readonly V2SystemMetricPayloadCount[],
  failures: Set<V2ExposureFailureKind>,
  log: Awaited<ReturnType<typeof finalizeLog>>,
  options: V2ExposureStorageOptions,
) {
  const countState = v2MetricPayloadCountState(counts, prepared.receipt);
  if (!countState.valid) failures.add('metric-payload-count');
  const failureKinds = [...failures];
  return {schema: V2_EXPOSURE_COMPLETION_SCHEMA, claimId: prepared.receipt.claimId,
    receiptSha256: prepared.receiptSha256,
    metricSpecSha256: prepared.receipt.metricSpecSha256,
    status: processEvidence.exitCode === 0 && processEvidence.signal === null &&
      failureKinds.length === 0 && countState.valid ? 'completed' : 'failed',
    process: processEvidence, failureKinds, metricPayloadCountKnown: countState.known,
    metricPayloadCountValid: countState.valid, metricPayloadCount: counts, log,
    completedAt: (options.now ?? (() => new Date()))().toISOString(),
    supervisorPid: options.pid ?? process.pid};
}

function killChild(child: ChildProcess | undefined): void {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

function fixedWorkerEnvironment(prepared: PreparedV2Exposure): NodeJS.ProcessEnv {
  return {
    HOME: homedir(),
    PATH: process.env.PATH ?? '',
    TMPDIR: tmpdir(),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    SEMANTIC_DARK_V2_CLAIM_ID: prepared.receipt.claimId,
    SEMANTIC_DARK_V2_RECEIPT_PATH: prepared.receiptPath,
    SEMANTIC_DARK_V2_METRIC_PAYLOAD_PATH: prepared.metricPayloadPath,
  };
}

async function captureChild(
  child: ChildProcess,
  writer: Writable,
  failures: Set<V2ExposureFailureKind>,
): Promise<V2ProcessEvidence> {
  child.stdout!.pipe(writer, {end: false});
  child.stderr!.pipe(writer, {end: false});
  child.once('error', (error) => {
    failures.add('spawn-error');
    safeLog(writer, supervisorLine('spawn-error', error));
  });
  const outcome = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>(
    (resolve) => child.once('close', (code, signal) => resolve({code, signal})),
  );
  return {childPid: child.pid ?? null, exitCode: outcome.code, signal: outcome.signal};
}

function applyProcessFailures(
  outcome: V2ProcessEvidence,
  failures: Set<V2ExposureFailureKind>,
): void {
  if (outcome.signal !== null) failures.add('signal');
  if (outcome.exitCode !== null && outcome.exitCode !== 0) failures.add('exit-code');
  if (outcome.exitCode === null && outcome.signal === null && !failures.has('spawn-error')) {
    failures.add('supervisor');
  }
}

function createLogWriter(prepared: PreparedV2Exposure) {
  let error: unknown;
  const writer = new Writable({write(chunk: Buffer, _encoding, callback) {
    prepared.logHandle.write(chunk).then(() => callback(), callback);
  }});
  const finished = new Promise<void>((resolve) => {
    writer.once('finish', resolve);
    writer.once('error', (value) => { error = value; resolve(); });
  });
  return {writer, finished, error: () => error};
}

async function finalizeLog(
  prepared: PreparedV2Exposure,
  state: ReturnType<typeof createLogWriter>,
  failures: Set<V2ExposureFailureKind>,
) {
  state.writer.end();
  await state.finished;
  if (state.error() !== undefined) failures.add('supervisor');
  await prepared.logHandle.chmod(0o400);
  await prepared.logHandle.sync();
  const info = await prepared.logHandle.stat();
  if ((info.mode & 0o777) !== 0o400 ||
      (process.getuid !== undefined && info.uid !== process.getuid())) {
    failures.add('supervisor');
  }
  const bytes = Buffer.alloc(info.size);
  if (info.size > 0) await prepared.logHandle.read(bytes, 0, info.size, 0);
  await prepared.logHandle.close();
  return {...prepared.receipt.log, byteLength: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex')};
}

function unavailableCounts(prepared: PreparedV2Exposure): readonly V2SystemMetricPayloadCount[] {
  const arms = prepared.receipt.variants.slice(2);
  return prepared.receipt.holdouts.map(({id}) => ({systemId: id,
    arms: arms.map((armId) => ({armId, count: null}))}));
}

function safeLog(writer: Writable, line: string): void {
  if (!writer.destroyed && !writer.writableEnded) writer.write(line);
}
function supervisorLine(kind: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[semantic-dark-supervisor:${kind}] ${message}\n`;
}
