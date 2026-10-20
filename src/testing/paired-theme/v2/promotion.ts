import {lstat} from 'node:fs/promises';
import path from 'node:path';

import {
  assertValidatedV2EvaluationContract,
  type V2ConfirmationGroup,
  type ValidatedV2EvaluationContract,
} from './contract';
import {
  buildV2ExposureBinding,
  assertFrozenV2ExecutionEvidence,
} from './exposure-contract';
import {
  productionV2ExposureStore,
  verifyImmutableV2EvidenceFile,
  verifyPersistedV2ExposureEvidence,
  v2PromotionOnceMarkerPath,
  writeV2PromotionOnceMarker,
} from './exposure';
import type {
  FrozenV2ExecutionEvidence,
  V2ExposureStore,
} from './exposure-types';
import {assertV2ExposureReceiptMatchesBinding, v2ExposureClaimId}
  from './exposure-validation';

export type V2PromotionIneligibleReason =
  | 'no-frozen-reserve-pair'
  | 'primary-evidence-unavailable'
  | 'primary-not-failed'
  | 'metric-count-not-exact-zero'
  | 'trigger-not-infrastructure'
  | 'promotion-already-recorded';

export interface V2PromotionIneligible {
  status: 'ineligible';
  reason: V2PromotionIneligibleReason;
}

declare const eligibilityBrand: unique symbol;
export interface EligibleV2Promotion {
  status: 'eligible-awaiting-human-report';
  primaryClaimId: string;
  primary: V2ConfirmationGroup;
  promoted: V2ConfirmationGroup;
  metricSpecSha256: string;
  completedAt: string;
  readonly [eligibilityBrand]: true;
}

declare const reportedPromotionBrand: unique symbol;
export interface ReportedV2Promotion {
  status: 'human-reported-not-executed';
  markerPath: string;
  markerSha256: string;
  promoted: V2ConfirmationGroup;
  readonly [reportedPromotionBrand]: true;
}

export type V2PromotionAssessment = V2PromotionIneligible | EligibleV2Promotion;

const eligiblePromotions = new WeakSet<object>();
const eligibilityStores = new WeakMap<object, V2ExposureStore>();
const reportedPromotions = new WeakSet<object>();
const INFRA_FAILURES = new Set(['spawn-error', 'signal', 'supervisor']);
const ALLOWED_FAILURES = new Set(['spawn-error', 'signal', 'supervisor',
  'metric-payload-count']);

/** Read-only assessment of the frozen primary; it never accepts a group selector. */
export async function assessV2PromotionEligibility(
  contract: ValidatedV2EvaluationContract,
  evidence: FrozenV2ExecutionEvidence,
  store: V2ExposureStore = productionV2ExposureStore(),
): Promise<V2PromotionAssessment> {
  assertValidatedV2EvaluationContract(contract);
  assertFrozenV2ExecutionEvidence(evidence);
  const promoted = contract.confirmation.reserves[0];
  if (promoted === undefined) return ineligible('no-frozen-reserve-pair');
  if (await pathExists(v2PromotionOnceMarkerPath(store))) {
    return ineligible('promotion-already-recorded');
  }
  const binding = buildV2ExposureBinding(contract, evidence);
  const primaryClaimId = v2ExposureClaimId(binding);
  let persisted;
  try { persisted = await verifyPersistedV2ExposureEvidence(primaryClaimId, store); }
  catch { return ineligible('primary-evidence-unavailable'); }
  assertV2ExposureReceiptMatchesBinding(persisted.receipt, binding);
  if (persisted.completion.status !== 'failed') return ineligible('primary-not-failed');
  const counts = persisted.completion.metricPayloadCount.flatMap(({arms}) => arms);
  if (!persisted.completion.metricPayloadCountKnown || counts.length === 0 ||
      counts.some(({count}) => count !== 0)) {
    return ineligible('metric-count-not-exact-zero');
  }
  const kinds = persisted.completion.failureKinds;
  if (!kinds.some((kind) => INFRA_FAILURES.has(kind)) ||
      kinds.some((kind) => !ALLOWED_FAILURES.has(kind))) {
    return ineligible('trigger-not-infrastructure');
  }
  const result = Object.freeze({status: 'eligible-awaiting-human-report' as const,
    primaryClaimId, primary: contract.confirmation.primary, promoted,
    metricSpecSha256: contract.metricSpecSha256,
    completedAt: persisted.completion.completedAt}) as EligibleV2Promotion;
  eligiblePromotions.add(result);
  eligibilityStores.set(result, store);
  return result;
}

/** Persist the global once marker only after a real immutable human-report artifact exists. */
export async function recordV2PromotionHumanReport(
  eligibility: EligibleV2Promotion,
  report: {path: string; sha256: string},
): Promise<ReportedV2Promotion> {
  if (!eligiblePromotions.has(eligibility)) {
    throw new Error('promotion report requires a branded primary eligibility assessment');
  }
  const store = eligibilityStores.get(eligibility)!;
  validateReportPin(report);
  const reportBytes = await verifyImmutableV2EvidenceFile(report.path, report.sha256, store);
  const reportDocument = validateReportDocument(reportBytes, eligibility);
  const marker = {
    schema: 'semantic-dark.confirmation-promotion.v2',
    status: 'human-reported-not-executed',
    primaryClaimId: eligibility.primaryClaimId,
    metricSpecSha256: eligibility.metricSpecSha256,
    primarySystems: [...eligibility.primary.systems],
    promotedSystems: [...eligibility.promoted.systems],
    humanReport: {...report, reportedAt: reportDocument.reportedAt},
  };
  const written = await writeV2PromotionOnceMarker(store, marker);
  const result = Object.freeze({status: 'human-reported-not-executed' as const,
    markerPath: written.path, markerSha256: written.sha256,
    promoted: eligibility.promoted}) as ReportedV2Promotion;
  reportedPromotions.add(result);
  return result;
}

export function assertReportedV2Promotion(value: ReportedV2Promotion): void {
  if (!reportedPromotions.has(value)) {
    throw new Error('reserve execution requires the global human-report promotion marker');
  }
}

function ineligible(reason: V2PromotionIneligibleReason): V2PromotionIneligible {
  return Object.freeze({status: 'ineligible', reason});
}

async function pathExists(filePath: string): Promise<boolean> {
  try { await lstat(filePath); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function validateReportPin(report: {path: string; sha256: string}): void {
  const keys = Object.keys(report).sort();
  if (keys.join(',') !== 'path,sha256' || !path.isAbsolute(report.path) ||
      path.normalize(report.path) !== report.path || !/^[0-9a-f]{64}$/.test(report.sha256)) {
    throw new Error('promotion human report evidence is invalid');
  }
}

function validateReportDocument(bytes: Buffer, eligibility: EligibleV2Promotion) {
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('promotion human report is not valid JSON'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('promotion human report has an unexpected shape');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'primaryClaimId,reportedAt,schema,status' ||
      input.schema !== 'semantic-dark.promotion-human-report.v2' ||
      input.status !== 'reported-to-project-owner' ||
      input.primaryClaimId !== eligibility.primaryClaimId ||
      typeof input.reportedAt !== 'string' || Number.isNaN(Date.parse(input.reportedAt)) ||
      new Date(input.reportedAt).toISOString() !== input.reportedAt ||
      Date.parse(input.reportedAt) < Date.parse(eligibility.completedAt)) {
    throw new Error('promotion human report does not prove the required notification');
  }
  return {reportedAt: input.reportedAt};
}
