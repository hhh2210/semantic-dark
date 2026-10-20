import {lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';

import {sha256Text} from '../../artifacts';
import {
  assertValidatedV2EvaluationContract,
  type V2ConfirmationGroup,
  type ValidatedV2EvaluationContract,
} from './contract';
import {
  productionV2ExposureStore,
  readPersistedV2ExposureReceipt,
} from './exposure';
import {
  type FrozenV2ExecutionEvidence,
  type V2ExposureBinding,
  type V2ExposureReceipt,
  type V2ExposureStore,
} from './exposure-types';
import {
  assertV2ExposureReceiptMatchesBinding,
  validateFrozenV2ExecutionEvidenceData,
  v2ExposureClaimId,
} from './exposure-validation';

export interface LoadFrozenV2ExecutionEvidenceOptions {
  repoRoot: string;
  evidencePath: string;
  expectedSha256: string;
}

declare const authorizedClaimBrand: unique symbol;
export interface AuthorizedV2ExposureClaim {
  contract: ValidatedV2EvaluationContract;
  group: V2ConfirmationGroup;
  binding: V2ExposureBinding;
  receipt: V2ExposureReceipt;
  receiptPath: string;
  readonly [authorizedClaimBrand]: true;
}

const frozenEvidence = new WeakSet<object>();
const derivedBindings = new WeakSet<object>();
const authorizedClaims = new WeakSet<object>();

/** Authenticate profile and commit pins from externally hash-pinned file bytes. */
export async function loadFrozenV2ExecutionEvidence(
  options: LoadFrozenV2ExecutionEvidenceOptions,
): Promise<FrozenV2ExecutionEvidence> {
  exactOptions(options);
  if (!/^[0-9a-f]{64}$/.test(options.expectedSha256)) {
    throw new TypeError('frozen execution evidence expectedSha256 is invalid');
  }
  const [rootReal, evidenceReal] = await Promise.all([
    realpath(options.repoRoot), realpath(options.evidencePath),
  ]);
  const relative = path.relative(rootReal, evidenceReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('frozen execution evidence escapes repo root');
  }
  const info = await lstat(options.evidencePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('frozen execution evidence must be a real file');
  }
  const bytes = await readFile(options.evidencePath, 'utf8');
  if (sha256Text(bytes) !== options.expectedSha256) {
    throw new Error('frozen execution evidence SHA-256 mismatch');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes); }
  catch { throw new Error('frozen execution evidence is not valid JSON'); }
  const result = validateFrozenV2ExecutionEvidenceData(parsed) as FrozenV2ExecutionEvidence;
  frozenEvidence.add(result);
  return result;
}

export function assertFrozenV2ExecutionEvidence(
  value: FrozenV2ExecutionEvidence,
): void {
  if (!frozenEvidence.has(value)) {
    throw new Error('V2 execution requires evidence loaded from externally pinned bytes');
  }
}

/** Primary is fixed by spec; no public group selector can expose a reserve early. */
export function buildV2ExposureBinding(
  contract: ValidatedV2EvaluationContract,
  evidence: FrozenV2ExecutionEvidence,
): V2ExposureBinding {
  assertValidatedV2EvaluationContract(contract);
  assertFrozenV2ExecutionEvidence(evidence);
  const group = contract.confirmation.primary;
  const holdouts = holdoutPins(contract, group);
  const {color, contrast, rank} = contract.denominators.perArm;
  const expectedMetricPayloadCountPerArm = color + contrast + rank;
  if (expectedMetricPayloadCountPerArm !== 19) {
    throw new Error('V2 exposure requires exact 10 D + 6 C + 3 R payload rows per arm');
  }
  const result = deepFreeze({
    metricSpecSha256: contract.metricSpecSha256,
    holdouts,
    variants: [...contract.variants.ordered],
    expectedMetricPayloadCountPerArm,
    profiles: evidence.profiles,
    candidateFreezeCommit: evidence.candidateFreezeCommit,
    evaluatorCommit: evidence.evaluatorCommit,
    engineCommit: evidence.engineCommit,
  }) as unknown as V2ExposureBinding;
  derivedBindings.add(result);
  return result;
}

export function assertContractDerivedV2ExposureBinding(value: V2ExposureBinding): void {
  if (!derivedBindings.has(value)) {
    throw new Error('V2 exposure requires a contract-derived branded binding');
  }
}

/** Reauthorize the persisted primary receipt immediately before protected value access. */
export async function loadAuthorizedV2ExposureClaim(
  contract: ValidatedV2EvaluationContract,
  evidence: FrozenV2ExecutionEvidence,
  store: V2ExposureStore = productionV2ExposureStore(),
): Promise<AuthorizedV2ExposureClaim> {
  const binding = buildV2ExposureBinding(contract, evidence);
  const claimId = v2ExposureClaimId(binding);
  const persisted = await readPersistedV2ExposureReceipt(claimId, store);
  const receipt = assertV2ExposureReceiptMatchesBinding(persisted.receipt, binding);
  const claim = Object.freeze({contract, group: contract.confirmation.primary,
    binding, receipt, receiptPath: persisted.receiptPath}) as unknown as AuthorizedV2ExposureClaim;
  authorizedClaims.add(claim);
  return claim;
}

export function assertAuthorizedV2ExposureClaim(value: AuthorizedV2ExposureClaim): void {
  if (!authorizedClaims.has(value)) {
    throw new Error('Protected v2 source access requires a persisted contract-matching claim');
  }
}

function holdoutPins(
  contract: ValidatedV2EvaluationContract,
  group: V2ConfirmationGroup,
) {
  return group.systems.map((id) => {
    const entry = contract.systems.find((system) => system.id === id);
    if (!entry || entry.purpose !== 'primary-holdout' || entry.split !== 'held-out') {
      throw new Error(`Primary confirmation system ${id} is absent from held-out registry`);
    }
    return {id, protocolSha256: entry.protocolSha256};
  });
}

function exactOptions(value: LoadFrozenV2ExecutionEvidenceOptions): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('frozen execution evidence options must be an object');
  }
  const actual = Object.keys(value).sort();
  const expected = ['evidencePath', 'expectedSha256', 'repoRoot'];
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('frozen execution evidence options have an unexpected shape');
  }
  for (const key of ['repoRoot', 'evidencePath'] as const) {
    if (!path.isAbsolute(value[key]) || path.normalize(value[key]) !== value[key]) {
      throw new TypeError(`${key} must be a normalized absolute path`);
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
