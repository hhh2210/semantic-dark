import type {EvaluationSplit} from '../types';
import {
  assertValidatedV2MetricSpec,
  loadValidatedV2MetricSpec,
  type ValidatedV2MetricSpec,
} from './spec';
import type {V2HumanReviewSpec} from './spec-human-review';
import type {V2RecordsSpec} from './spec-records';
import type {V2TuningSpec} from './spec-tuning';

const validatedContracts = new WeakSet<object>();

export interface V2VariantRoles {
  light: string; authoredDark: string; baselineCandidate: string; m2Candidate: string;
}

export interface V2SystemRegistryEntry {
  id: string;
  split: EvaluationSplit;
  purpose: 'development' | 'primary-holdout' | 'reserve';
  adapterId: string;
  protocolPath: string;
  protocolSha256: string;
  sceneManifestPath: string;
  sceneManifestSha256: string;
}

export interface V2ConfirmationGroup {
  id: string;
  systems: readonly [string, string];
}

export interface V2ConfirmationRegistry {
  primary: V2ConfirmationGroup;
  reserves: readonly V2ConfirmationGroup[];
}

export interface V2DenominatorContract {
  scenesPerSystem: number;
  paintsPerVariant: number;
  rawObservationsPerSystemPerReplicate: number;
  rawObservationsPerSystemAcrossReplicates: number;
  perArm: {reviewed: number; color: number; contrast: number; rank: number};
  comparison: {color: number; contrast: number; rank: number};
  reviewedSystems: number;
  totalReviewedRows: number;
}

export interface V2MetricConfig {
  status: 'frozen-v2';
  deltaEOkCap: number; contrastLog2Cap: number; rankTieEpsilon: number;
  comparisonEpsilon: number; accentChromaThreshold: number;
  textContrastFloor: number; nonTextContrastFloor: number; surfaceSeparationFloor: number;
  componentWeights: {color: number; contrast: number; rank: number};
}

export interface V2MetricSpecDocument {
  $schema: string;
  schema: 'semantic-dark.paired-theme-metric-spec.v2';
  id: 'semantic-dark.paired-theme-metric.v2';
  version: 2;
  status: 'frozen';
  baseline: Readonly<Record<string, unknown>>;
  registry: {
    systems: readonly V2SystemRegistryEntry[];
    confirmation: V2ConfirmationRegistry;
  };
  records: V2RecordsSpec;
  evaluationContract: {
    variants: {ordered: readonly string[]; roles: V2VariantRoles};
    replicatesPerSystem: number;
    denominators: V2DenominatorContract;
    metric: V2MetricConfig;
    componentNonRegressionTolerance: number;
  };
  humanReview: V2HumanReviewSpec;
  tuning: V2TuningSpec;
  exposure: Readonly<Record<string, unknown>>;
  implementationPins: Readonly<Record<string, unknown>>;
}

export interface LoadV2MetricSpecOptions {
  repoRoot: string; specPath: string; expectedSha256: string;
}

export interface V2EvaluationContract {
  readonly schema: 'semantic-dark.paired-theme-evaluation-contract.v2';
  readonly status: 'frozen';
  readonly metricSpecId: 'semantic-dark.paired-theme-metric.v2';
  readonly metricSpecPath: string;
  readonly metricSpecSha256: string;
  readonly systems: readonly V2SystemRegistryEntry[];
  readonly activeSystemIds: readonly string[];
  readonly developmentSystemIds: readonly string[];
  readonly primaryHoldoutSystemIds: readonly string[];
  readonly reserveSystemIds: readonly string[];
  readonly confirmation: Readonly<V2ConfirmationRegistry>;
  readonly records: Readonly<V2RecordsSpec>;
  readonly variants: {
    readonly ordered: readonly string[];
    readonly roles: Readonly<V2VariantRoles>;
  };
  readonly replicatesPerSystem: number;
  readonly denominators: Readonly<V2DenominatorContract>;
  readonly metric: Readonly<V2MetricConfig>;
  readonly componentNonRegressionTolerance: number;
}

declare const validatedV2ContractBrand: unique symbol;

export type ValidatedV2EvaluationContract = V2EvaluationContract & {
  readonly [validatedV2ContractBrand]: true;
};

/** Load the only evaluator contract accepted at runtime from pinned spec bytes. */
export async function loadV2EvaluationContract(
  options: LoadV2MetricSpecOptions,
): Promise<ValidatedV2EvaluationContract> {
  return evaluationContractFromV2MetricSpec(await loadValidatedV2MetricSpec(options));
}

/** Project a contract only from a runtime-authenticated metric-spec document. */
export function evaluationContractFromV2MetricSpec(
  loaded: ValidatedV2MetricSpec,
): ValidatedV2EvaluationContract {
  assertValidatedV2MetricSpec(loaded);
  const {document} = loaded;
  const systems = document.registry.systems;
  const byPurpose = (purpose: V2SystemRegistryEntry['purpose']) =>
    systems.filter((entry) => entry.purpose === purpose).map((entry) => entry.id);
  const developmentSystemIds = byPurpose('development');
  const primaryHoldoutSystemIds = [...document.registry.confirmation.primary.systems];
  const reserveSystemIds = document.registry.confirmation.reserves.flatMap((group) => group.systems);
  const result = deepFreeze({
    schema: 'semantic-dark.paired-theme-evaluation-contract.v2' as const,
    status: 'frozen' as const,
    metricSpecId: document.id,
    metricSpecPath: loaded.path,
    metricSpecSha256: loaded.sha256,
    systems,
    activeSystemIds: [...developmentSystemIds, ...primaryHoldoutSystemIds],
    developmentSystemIds,
    primaryHoldoutSystemIds,
    reserveSystemIds,
    confirmation: document.registry.confirmation,
    records: document.records,
    variants: document.evaluationContract.variants,
    replicatesPerSystem: document.evaluationContract.replicatesPerSystem,
    denominators: document.evaluationContract.denominators,
    metric: document.evaluationContract.metric,
    componentNonRegressionTolerance:
      document.evaluationContract.componentNonRegressionTolerance,
  }) as unknown as ValidatedV2EvaluationContract;
  validatedContracts.add(result);
  return result;
}

/** @deprecated Raw-object construction is intentionally forbidden in v2. */
export interface V2EvaluationContractInput {
  readonly schema: 'semantic-dark.paired-theme-evaluation-contract.v2';
  readonly status: 'frozen';
  readonly metricSpecSha256: string;
  readonly systems: readonly {
    id: string; split: EvaluationSplit;
    purpose: 'development' | 'primary-holdout' | 'reserve';
  }[];
  readonly variants: {ordered: readonly string[]; roles: V2VariantRoles};
  readonly replicatesPerSystem: number;
  readonly denominators: Omit<V2DenominatorContract, 'reviewedSystems' | 'totalReviewedRows'>;
}

/** @deprecated Use loadV2EvaluationContract with an external expected SHA-256. */
export function validateV2EvaluationContract(_value: unknown): never {
  throw new Error(
    'Raw v2 contract construction is forbidden; load pinned metric-spec bytes instead',
  );
}

export function assertValidatedV2EvaluationContract(
  value: ValidatedV2EvaluationContract,
): void {
  if (!validatedContracts.has(value)) {
    throw new Error('V2 evaluator requires a contract loaded from pinned metric-spec bytes');
  }
}

export function requireRegisteredSystem(
  contract: ValidatedV2EvaluationContract,
  system: string,
  split: EvaluationSplit,
): V2SystemRegistryEntry {
  assertValidatedV2EvaluationContract(contract);
  const entry = contract.systems.find((item) => item.id === system);
  if (!entry) throw new Error(`System ${system} is absent from the frozen v2 registry`);
  if (entry.split !== split) throw new Error(
    `System ${system} belongs to ${entry.split}, not ${split}`,
  );
  return entry;
}

export function registeredSystemSet(
  contract: ValidatedV2EvaluationContract,
): ReadonlySet<string> {
  assertValidatedV2EvaluationContract(contract);
  return new Set(contract.systems.map((entry) => entry.id));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
