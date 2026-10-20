export const V2_EXPOSURE_RECEIPT_SCHEMA =
  'semantic-dark.held-out-exposure-receipt.v2' as const;
export const V2_EXPOSURE_COMPLETION_SCHEMA =
  'semantic-dark.held-out-exposure-completion.v2' as const;
export const V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA =
  'semantic-dark.frozen-execution-evidence.v2' as const;
export const V2_METRIC_PAYLOAD_COUNT_SCHEMA =
  'semantic-dark.metric-payload-count.v2' as const;

export interface V2HoldoutPin {
  id: string;
  protocolSha256: string;
}

export interface V2ProfileEvidencePin {
  semanticSha256: string;
  fileSha256: string;
}

/** Valid data, but not an execution capability. */
export interface V2ExposureBindingData {
  metricSpecSha256: string;
  holdouts: readonly V2HoldoutPin[];
  variants: readonly string[];
  expectedMetricPayloadCountPerArm: number;
  profiles: {
    baseline: V2ProfileEvidencePin;
    candidate: V2ProfileEvidencePin;
  };
  candidateFreezeCommit: string;
  evaluatorCommit: string;
  engineCommit: string;
}

declare const contractDerivedBindingBrand: unique symbol;
export type V2ExposureBinding = V2ExposureBindingData & {
  readonly [contractDerivedBindingBrand]: true;
};

export interface V2FrozenExecutionEvidenceData {
  schema: typeof V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA;
  status: 'frozen';
  profiles: V2ExposureBindingData['profiles'];
  candidateFreezeCommit: string;
  evaluatorCommit: string;
  engineCommit: string;
}

declare const frozenExecutionEvidenceBrand: unique symbol;
export type FrozenV2ExecutionEvidence = V2FrozenExecutionEvidenceData & {
  readonly [frozenExecutionEvidenceBrand]: true;
};

export interface V2ExposureReceipt extends V2ExposureBindingData {
  schema: typeof V2_EXPOSURE_RECEIPT_SCHEMA;
  claimId: string;
  status: 'claimed-consumes-exposure';
  log: {id: string; path: string};
  failureConsumesExposure: true;
  createdAt: string;
  pid: number;
}

export interface V2MetricArmPayloadCount {
  armId: string;
  count: number | null;
}

export interface V2SystemMetricPayloadCount {
  systemId: string;
  arms: readonly V2MetricArmPayloadCount[];
}

export interface V2MetricPayloadCountArtifact {
  schema: typeof V2_METRIC_PAYLOAD_COUNT_SCHEMA;
  claimId: string;
  systems: readonly V2SystemMetricPayloadCount[];
}

export type V2ExposureFailureKind =
  | 'exit-code'
  | 'signal'
  | 'spawn-error'
  | 'metric-payload-count'
  | 'supervisor';

export interface V2ExposureCompletion {
  schema: typeof V2_EXPOSURE_COMPLETION_SCHEMA;
  claimId: string;
  receiptSha256: string;
  metricSpecSha256: string;
  status: 'completed' | 'failed';
  process: {
    childPid: number | null;
    exitCode: number | null;
    signal: string | null;
  };
  failureKinds: readonly V2ExposureFailureKind[];
  metricPayloadCountKnown: boolean;
  metricPayloadCountValid: boolean;
  metricPayloadCount: readonly V2SystemMetricPayloadCount[];
  log: {id: string; path: string; byteLength: number; sha256: string};
  completedAt: string;
  supervisorPid: number;
}

declare const exposureStoreBrand: unique symbol;
export interface V2ExposureStore {
  readonly rootDirectory: string;
  readonly kind: 'production' | 'internal-test';
  readonly [exposureStoreBrand]: true;
}

export interface V2ExposureStorageOptions {
  store?: V2ExposureStore;
  now?: () => Date;
  pid?: number;
  logIdFactory?: () => string;
}
