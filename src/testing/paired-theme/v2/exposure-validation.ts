import path from 'node:path';

import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import {
  V2_EXPOSURE_COMPLETION_SCHEMA,
  V2_EXPOSURE_RECEIPT_SCHEMA,
  V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA,
  V2_METRIC_PAYLOAD_COUNT_SCHEMA,
  type V2ExposureBindingData,
  type V2ExposureCompletion,
  type V2ExposureFailureKind,
  type V2ExposureReceipt,
  type V2FrozenExecutionEvidenceData,
  type V2MetricPayloadCountArtifact,
  type V2SystemMetricPayloadCount,
} from './exposure-types';

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;
const LOG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAILURE_KINDS = new Set<V2ExposureFailureKind>([
  'exit-code', 'signal', 'spawn-error', 'metric-payload-count', 'supervisor',
]);

/** Shape validation only. It deliberately does not grant execution capability. */
export function validateV2ExposureBinding(value: unknown): V2ExposureBindingData {
  const input = object(value, 'v2 exposure binding');
  exactKeys(input, ['metricSpecSha256', 'holdouts', 'variants',
    'expectedMetricPayloadCountPerArm', 'profiles', 'candidateFreezeCommit',
    'evaluatorCommit', 'engineCommit'], 'v2 exposure binding');
  const profiles = object(input.profiles, 'profiles');
  exactKeys(profiles, ['baseline', 'candidate'], 'profiles');
  return deepFreeze({
    metricSpecSha256: digest(input.metricSpecSha256, 'metricSpecSha256'),
    holdouts: holdoutPins(input.holdouts),
    variants: identifierArray(input.variants, 'variants', 4),
    expectedMetricPayloadCountPerArm: positiveInteger(
      input.expectedMetricPayloadCountPerArm, 'expectedMetricPayloadCountPerArm'),
    profiles: {
      baseline: profilePin(profiles.baseline, 'profiles.baseline'),
      candidate: profilePin(profiles.candidate, 'profiles.candidate'),
    },
    candidateFreezeCommit: commit(input.candidateFreezeCommit, 'candidateFreezeCommit'),
    evaluatorCommit: commit(input.evaluatorCommit, 'evaluatorCommit'),
    engineCommit: commit(input.engineCommit, 'engineCommit'),
  });
}

export function validateFrozenV2ExecutionEvidenceData(
  value: unknown,
): V2FrozenExecutionEvidenceData {
  const input = object(value, 'frozen v2 execution evidence');
  exactKeys(input, ['schema', 'status', 'profiles', 'candidateFreezeCommit',
    'evaluatorCommit', 'engineCommit'], 'frozen v2 execution evidence');
  if (input.schema !== V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA || input.status !== 'frozen') {
    throw new Error('frozen v2 execution evidence identity is invalid');
  }
  const profiles = object(input.profiles, 'profiles');
  exactKeys(profiles, ['baseline', 'candidate'], 'profiles');
  return deepFreeze({
    schema: V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA,
    status: 'frozen' as const,
    profiles: {baseline: profilePin(profiles.baseline, 'profiles.baseline'),
      candidate: profilePin(profiles.candidate, 'profiles.candidate')},
    candidateFreezeCommit: commit(input.candidateFreezeCommit, 'candidateFreezeCommit'),
    evaluatorCommit: commit(input.evaluatorCommit, 'evaluatorCommit'),
    engineCommit: commit(input.engineCommit, 'engineCommit'),
  });
}

/** Pair-global identity: changing order/spec/candidate cannot reclaim consumed systems. */
export function v2ExposureClaimId(value: unknown): string {
  const binding = validateV2ExposureBinding(value);
  return sha256Text(serializeCanonicalJson({
    schema: 'semantic-dark.held-out-exposure-identity.v2',
    holdoutIds: binding.holdouts.map(({id}) => id).sort(),
  }));
}

export function validateV2LogId(value: unknown): string {
  return stringMatch(value, LOG_ID, 'log.id');
}

export function validateV2ExposureReceipt(value: unknown): V2ExposureReceipt {
  const input = object(value, 'v2 exposure receipt');
  exactKeys(input, ['schema', 'claimId', 'status', 'metricSpecSha256', 'holdouts',
    'variants', 'expectedMetricPayloadCountPerArm', 'profiles', 'candidateFreezeCommit',
    'evaluatorCommit', 'engineCommit', 'log', 'failureConsumesExposure', 'createdAt',
    'pid'], 'v2 exposure receipt');
  if (input.schema !== V2_EXPOSURE_RECEIPT_SCHEMA ||
      input.status !== 'claimed-consumes-exposure' || input.failureConsumesExposure !== true) {
    throw new Error('v2 exposure receipt status contract is invalid');
  }
  const binding = validateV2ExposureBinding({
    metricSpecSha256: input.metricSpecSha256,
    holdouts: input.holdouts,
    variants: input.variants,
    expectedMetricPayloadCountPerArm: input.expectedMetricPayloadCountPerArm,
    profiles: input.profiles,
    candidateFreezeCommit: input.candidateFreezeCommit,
    evaluatorCommit: input.evaluatorCommit,
    engineCommit: input.engineCommit,
  });
  const claimId = digest(input.claimId, 'claimId');
  if (claimId !== v2ExposureClaimId(binding)) throw new Error('v2 receipt claimId mismatch');
  const log = object(input.log, 'log');
  exactKeys(log, ['id', 'path'], 'log');
  const logId = validateV2LogId(log.id);
  const logPath = absolutePath(log.path, 'log.path');
  if (path.basename(logPath) !== `${claimId}.${logId}.log`) {
    throw new Error('log.path does not bind claimId and log.id');
  }
  return deepFreeze({schema: V2_EXPOSURE_RECEIPT_SCHEMA, claimId,
    status: 'claimed-consumes-exposure' as const, ...binding, log: {id: logId, path: logPath},
    failureConsumesExposure: true as const, createdAt: timestamp(input.createdAt, 'createdAt'),
    pid: positiveInteger(input.pid, 'pid')});
}

export function assertV2ExposureReceiptMatchesBinding(
  receiptValue: unknown,
  bindingValue: unknown,
): V2ExposureReceipt {
  const receipt = validateV2ExposureReceipt(receiptValue);
  const binding = validateV2ExposureBinding(bindingValue);
  const actual = bindingFromReceipt(receipt);
  if (serializeCanonicalJson(actual) !== serializeCanonicalJson(binding)) {
    throw new Error('v2 exposure receipt does not match the protected execution binding');
  }
  return receipt;
}

export function validateV2MetricPayloadCount(
  value: unknown,
  receipt: V2ExposureReceipt,
): readonly V2SystemMetricPayloadCount[] {
  if (!Array.isArray(value) || value.length !== receipt.holdouts.length) {
    throw new Error('metricPayloadCount must contain every claimed holdout exactly once');
  }
  const armIds = receipt.variants.slice(2);
  return deepFreeze(value.map((entry, systemIndex) => {
    const input = object(entry, `metricPayloadCount[${systemIndex}]`);
    exactKeys(input, ['systemId', 'arms'], `metricPayloadCount[${systemIndex}]`);
    const expectedSystem = receipt.holdouts[systemIndex]!.id;
    if (input.systemId !== expectedSystem) throw new Error('metricPayloadCount system order mismatch');
    if (!Array.isArray(input.arms) || input.arms.length !== armIds.length) {
      throw new Error(`metricPayloadCount arms invalid for ${expectedSystem}`);
    }
    const arms = input.arms.map((entryValue, armIndex) => {
      const arm = object(entryValue, `${expectedSystem}.arms[${armIndex}]`);
      exactKeys(arm, ['armId', 'count'], `${expectedSystem}.arms[${armIndex}]`);
      if (arm.armId !== armIds[armIndex]) throw new Error('metricPayloadCount arm order mismatch');
      return {armId: arm.armId as string, count: nullableCount(arm.count)};
    });
    return {systemId: expectedSystem, arms};
  }));
}

export function validateV2MetricPayloadCountArtifact(
  value: unknown,
  receipt: V2ExposureReceipt,
): V2MetricPayloadCountArtifact {
  const input = object(value, 'metric payload count artifact');
  exactKeys(input, ['schema', 'claimId', 'systems'], 'metric payload count artifact');
  if (input.schema !== V2_METRIC_PAYLOAD_COUNT_SCHEMA || input.claimId !== receipt.claimId) {
    throw new Error('metric payload count artifact identity mismatch');
  }
  return deepFreeze({schema: V2_METRIC_PAYLOAD_COUNT_SCHEMA, claimId: receipt.claimId,
    systems: validateV2MetricPayloadCount(input.systems, receipt)});
}

export function v2MetricPayloadCountState(
  counts: readonly V2SystemMetricPayloadCount[], receipt: V2ExposureReceipt,
): {known: boolean; valid: boolean} {
  const flat = counts.flatMap(({arms}) => arms);
  const known = flat.every(({count}) => count !== null);
  return {known, valid: known && flat.every(
    ({count}) => count === receipt.expectedMetricPayloadCountPerArm)};
}

export function validateV2ExposureCompletion(
  value: unknown, receiptValue: unknown,
): V2ExposureCompletion {
  const receipt = validateV2ExposureReceipt(receiptValue);
  const input = object(value, 'v2 exposure completion');
  exactKeys(input, ['schema', 'claimId', 'receiptSha256', 'metricSpecSha256', 'status',
    'process', 'failureKinds', 'metricPayloadCountKnown', 'metricPayloadCountValid',
    'metricPayloadCount', 'log', 'completedAt', 'supervisorPid'], 'v2 exposure completion');
  if (input.schema !== V2_EXPOSURE_COMPLETION_SCHEMA || input.claimId !== receipt.claimId ||
      input.metricSpecSha256 !== receipt.metricSpecSha256) {
    throw new Error('v2 completion identity does not match receipt');
  }
  const processValue = processOutcome(input.process);
  const failureKinds = failures(input.failureKinds);
  const counts = validateV2MetricPayloadCount(input.metricPayloadCount, receipt);
  const countState = v2MetricPayloadCountState(counts, receipt);
  if (input.metricPayloadCountKnown !== countState.known ||
      input.metricPayloadCountValid !== countState.valid) {
    throw new Error('metric payload known/valid flags do not match counts');
  }
  const hasExitFailure = processValue.exitCode !== null && processValue.exitCode !== 0;
  if (failureKinds.includes('exit-code') !== hasExitFailure ||
      failureKinds.includes('signal') !== (processValue.signal !== null) ||
      failureKinds.includes('metric-payload-count') !== !countState.valid) {
    throw new Error('failureKinds do not match captured process/count evidence');
  }
  if (processValue.exitCode === null && processValue.signal === null &&
      !failureKinds.includes('spawn-error') && !failureKinds.includes('supervisor')) {
    throw new Error('null process outcome requires spawn-error or supervisor evidence');
  }
  const completed = processValue.exitCode === 0 && processValue.signal === null &&
    failureKinds.length === 0 && countState.valid;
  if ((input.status === 'completed') !== completed ||
      (input.status !== 'completed' && input.status !== 'failed')) {
    throw new Error('v2 completion status is inconsistent with process evidence');
  }
  const log = object(input.log, 'completion.log');
  exactKeys(log, ['id', 'path', 'byteLength', 'sha256'], 'completion.log');
  if (log.id !== receipt.log.id || log.path !== receipt.log.path) {
    throw new Error('completion log identity does not match receipt');
  }
  const receiptSha256 = digest(input.receiptSha256, 'receiptSha256');
  const completedAt = timestamp(input.completedAt, 'completedAt');
  if (receiptSha256 !== sha256Text(serializeCanonicalJson(receipt)) ||
      Date.parse(completedAt) < Date.parse(receipt.createdAt)) {
    throw new Error('completion receipt hash/time does not match its exposure claim');
  }
  return deepFreeze({schema: V2_EXPOSURE_COMPLETION_SCHEMA, claimId: receipt.claimId,
    receiptSha256, metricSpecSha256: receipt.metricSpecSha256, status: input.status,
    process: processValue, failureKinds, metricPayloadCountKnown: countState.known,
    metricPayloadCountValid: countState.valid, metricPayloadCount: counts,
    log: {id: receipt.log.id, path: receipt.log.path,
      byteLength: nonnegativeInteger(log.byteLength, 'log.byteLength'),
      sha256: digest(log.sha256, 'log.sha256')}, completedAt,
    supervisorPid: positiveInteger(input.supervisorPid, 'supervisorPid')});
}

function bindingFromReceipt(receipt: V2ExposureReceipt): V2ExposureBindingData {
  const {metricSpecSha256, holdouts, variants, expectedMetricPayloadCountPerArm,
    profiles, candidateFreezeCommit, evaluatorCommit, engineCommit} = receipt;
  return {metricSpecSha256, holdouts, variants, expectedMetricPayloadCountPerArm,
    profiles, candidateFreezeCommit, evaluatorCommit, engineCommit};
}
function holdoutPins(value: unknown): V2ExposureBindingData['holdouts'] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('holdouts must be one ordered pair');
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const input = object(entry, `holdouts[${index}]`);
    exactKeys(input, ['id', 'protocolSha256'], `holdouts[${index}]`);
    const id = identifier(input.id, `holdouts[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate holdout id: ${id}`); ids.add(id);
    return {id, protocolSha256: digest(input.protocolSha256, `holdouts[${index}].protocolSha256`)};
  });
}
function profilePin(value: unknown, label: string) {
  const input = object(value, label); exactKeys(input, ['semanticSha256', 'fileSha256'], label);
  return {semanticSha256: digest(input.semanticSha256, `${label}.semanticSha256`),
    fileSha256: digest(input.fileSha256, `${label}.fileSha256`)};
}
function processOutcome(value: unknown): V2ExposureCompletion['process'] {
  const input = object(value, 'process'); exactKeys(input, ['childPid', 'exitCode', 'signal'], 'process');
  return {childPid: nullablePositiveInteger(input.childPid, 'process.childPid'),
    exitCode: nullableInteger(input.exitCode, 'process.exitCode'),
    signal: nullableString(input.signal, 'process.signal')};
}
function failures(value: unknown): readonly V2ExposureFailureKind[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length ||
      value.some((item) => !FAILURE_KINDS.has(item as V2ExposureFailureKind))) {
    throw new Error('failureKinds must be a unique known-kind array');
  }
  return value as V2ExposureFailureKind[];
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} has an unexpected shape`);
}
function identifierArray(value: unknown, label: string, length: number): readonly string[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must contain exactly ${length} identifiers`);
  const result = value.map((item, index) => identifier(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`); return result;
}
function identifier(value: unknown, label: string): string { return stringMatch(value, IDENTIFIER, label); }
function digest(value: unknown, label: string): string { return stringMatch(value, SHA256, label); }
function commit(value: unknown, label: string): string { return stringMatch(value, COMMIT, label); }
function stringMatch(value: unknown, pattern: RegExp, label: string): string { if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function absolutePath(value: unknown, label: string): string { if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) throw new TypeError(`${label} must be a normalized absolute path`); return value; }
function timestamp(value: unknown, label: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError(`${label} must be an ISO timestamp`); return value; }
function nullableCount(value: unknown): number | null { return value === null ? null : nonnegativeInteger(value, 'metric payload count'); }
function positiveInteger(value: unknown, label: string): number { const result = nonnegativeInteger(value, label); if (result === 0) throw new TypeError(`${label} must be positive`); return result; }
function nullablePositiveInteger(value: unknown, label: string): number | null { return value === null ? null : positiveInteger(value, label); }
function nullableInteger(value: unknown, label: string): number | null { if (value === null) return null; if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${label} must be an integer or null`); return value; }
function nullableString(value: unknown, label: string): string | null { if (value === null) return null; if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a nonempty string or null`); return value; }
function nonnegativeInteger(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative integer`); return value; }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); } return value; }
