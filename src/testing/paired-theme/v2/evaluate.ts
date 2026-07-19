import type {AutomaticFinding} from '../evaluation-types';
import {
  assertValidatedV2EvaluationContract,
  requireRegisteredSystem,
  type ValidatedV2EvaluationContract,
} from './contract';
import {evaluateV2Arm, type V2ArmEvaluation} from './evaluate-arm';
import {
  assertValidatedV2ObservationReplicate,
  type V2ObservationReplicate,
} from './observations';
import {
  assertLoadedV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from './protocol';

export interface FindingDelta {
  id: string;
  status: 'new' | 'worsened' | 'unchanged' | 'resolved';
  baseline: AutomaticFinding | null;
  candidate: AutomaticFinding | null;
}

export interface V2SystemComparison {
  schema: 'semantic-dark.paired-theme-system-comparison.v2';
  metricSpecSha256: string;
  protocolSha256: string;
  sceneManifestSha256: string;
  system: string;
  split: 'development' | 'held-out';
  replicateIds: readonly string[];
  counts: {
    scenes: number;
    paintsPerVariant: number;
    variants: number;
    replicates: number;
    rawObservationsPerReplicate: number;
    rawObservationsAcrossReplicates: number;
    perArm: {reviewed: number; color: number; contrast: number; rank: number};
    comparison: {color: number; contrast: number; rank: number};
  };
  baseline: V2ArmEvaluation;
  candidate: V2ArmEvaluation;
  comparison: {
    relativeImprovement: {
      formula: '(E_baseline-E_candidate)/E_baseline';
      baselineE: number;
      candidateE: number;
      value: number | null;
      status: 'valid' | 'not-evaluable-baseline-zero';
    };
    componentNonRegression: {d: boolean; c: boolean; r: boolean};
    findingDeltas: readonly FindingDelta[];
    newOrWorsenedF: number;
  };
}

/** Score both arms across every actual replicate declared by the frozen v2 contract. */
export function evaluateV2System(
  replicates: readonly V2ObservationReplicate[],
  loaded: LoadedV2RegisteredProtocol,
  contract: ValidatedV2EvaluationContract,
): V2SystemComparison {
  assertValidatedV2EvaluationContract(contract);
  assertLoadedV2RegisteredProtocol(loaded);
  const registered = requireRegisteredSystem(
    contract, loaded.registry.id, loaded.registry.split,
  );
  if (registered !== loaded.registry || loaded.metricSpecSha256 !== contract.metricSpecSha256) {
    throw new Error('V2 evaluator requires the registered protocol for the same metric spec');
  }
  const scenes = loaded.scenes.scenes;
  const componentTolerance = contract.componentNonRegressionTolerance;
  if (replicates.length !== contract.replicatesPerSystem) {
    throw new Error(
      `V2 replicate denominator mismatch: expected ${contract.replicatesPerSystem}, received ${replicates.length}`,
    );
  }
  const replicateIds = replicates.map((item) => item.replicateId);
  if (new Set(replicateIds).size !== replicateIds.length) {
    throw new Error('V2 replicate ids must be unique');
  }

  const first = replicates[0]!;
  requireRegisteredSystem(contract, first.system, first.split);
  const evaluated = replicates.map((replicate) => {
    assertReplicateIdentity(replicate, first, contract, loaded);
    const baseline = evaluateV2Arm(replicate.baselineMatrix, scenes, contract);
    const candidate = evaluateV2Arm(replicate.candidateMatrix, scenes, contract);
    assertArmDenominators(baseline, contract, 'baseline');
    assertArmDenominators(candidate, contract, 'candidate');
    return {baseline, candidate};
  });
  const rawAcrossReplicates = replicates.reduce((sum, item) =>
    sum + item.rawObservationCount, 0);
  if (rawAcrossReplicates !==
      contract.denominators.rawObservationsPerSystemAcrossReplicates) {
    throw new Error(`V2 cross-replicate raw denominator mismatch: ${rawAcrossReplicates}`);
  }
  assertReproducesExactly(evaluated);

  const baseline = evaluated[0]!.baseline;
  const candidate = evaluated[0]!.candidate;
  const findingDeltas = compareFindings(
    baseline.findings,
    candidate.findings,
  );
  const baselineE = baseline.primary.e;
  const candidateE = candidate.primary.e;
  const baselineNonZero = baselineE !== 0;
  const denominators = contract.denominators;
  return {
    schema: 'semantic-dark.paired-theme-system-comparison.v2',
    metricSpecSha256: contract.metricSpecSha256,
    protocolSha256: loaded.protocolSha256,
    sceneManifestSha256: loaded.sceneManifestSha256,
    system: first.system,
    split: first.split,
    replicateIds,
    counts: {
      scenes: denominators.scenesPerSystem,
      paintsPerVariant: denominators.paintsPerVariant,
      variants: contract.variants.ordered.length,
      replicates: contract.replicatesPerSystem,
      rawObservationsPerReplicate: denominators.rawObservationsPerSystemPerReplicate,
      rawObservationsAcrossReplicates: denominators.rawObservationsPerSystemAcrossReplicates,
      perArm: {...denominators.perArm},
      comparison: {...denominators.comparison},
    },
    baseline,
    candidate,
    comparison: {
      relativeImprovement: {
        formula: '(E_baseline-E_candidate)/E_baseline',
        baselineE,
        candidateE,
        value: baselineNonZero ? (baselineE - candidateE) / baselineE : null,
        status: baselineNonZero ? 'valid' : 'not-evaluable-baseline-zero',
      },
      componentNonRegression: {
        d: candidate.primary.d <= baseline.primary.d + componentTolerance,
        c: candidate.primary.c <= baseline.primary.c + componentTolerance,
        r: candidate.primary.r <= baseline.primary.r + componentTolerance,
      },
      findingDeltas,
      newOrWorsenedF: findingDeltas.filter((item) =>
        item.status === 'new' || item.status === 'worsened').length,
    },
  };
}

function assertReplicateIdentity(
  replicate: V2ObservationReplicate,
  first: V2ObservationReplicate,
  contract: ValidatedV2EvaluationContract,
  loaded: LoadedV2RegisteredProtocol,
): void {
  assertValidatedV2ObservationReplicate(replicate);
  requireRegisteredSystem(contract, replicate.system, replicate.split);
  if (replicate.system !== first.system || replicate.split !== first.split) {
    throw new Error('V2 replicates must belong to one system and split');
  }
  if (replicate.metricSpecSha256 !== contract.metricSpecSha256) {
    throw new Error(`V2 replicate ${replicate.replicateId} uses a different metric spec`);
  }
  if (replicate.protocolSha256 !== loaded.protocolSha256 ||
      replicate.sceneManifestSha256 !== loaded.sceneManifestSha256 ||
      replicate.system !== loaded.registry.id || replicate.split !== loaded.registry.split) {
    throw new Error(`V2 replicate ${replicate.replicateId} uses a different registered protocol`);
  }
  if (replicate.observationSha256 !== first.observationSha256) {
    throw new Error(
      `V2 replicate ${replicate.replicateId} raw observations do not reproduce replicate 1 exactly`,
    );
  }
  if (replicate.rawObservationCount !==
      contract.denominators.rawObservationsPerSystemPerReplicate) {
    throw new Error(
      `V2 replicate ${replicate.replicateId} raw denominator mismatch: ${replicate.rawObservationCount}`,
    );
  }
  if (!replicate.baselineMatrix) throw new Error(
    `V2 replicate ${replicate.replicateId} is missing the baseline arm`,
  );
  if (!replicate.candidateMatrix) throw new Error(
    `V2 replicate ${replicate.replicateId} is missing the candidate arm`,
  );
  for (const [label, matrix] of [
    ['baseline', replicate.baselineMatrix],
    ['candidate', replicate.candidateMatrix],
  ] as const) {
    if (String(matrix.system) !== replicate.system || matrix.split !== replicate.split) {
      throw new Error(`V2 ${label} arm provenance mismatch in ${replicate.replicateId}`);
    }
  }
}

function assertArmDenominators(
  evaluation: V2ArmEvaluation,
  contract: ValidatedV2EvaluationContract,
  arm: string,
): void {
  const expected = contract.denominators;
  const actual = [
    evaluation.counts.scenes,
    evaluation.counts.paintsPerVariant,
    evaluation.counts.reviewedDecisions,
    evaluation.counts.colorRows,
    evaluation.counts.contrastRows,
    evaluation.counts.rankPairs,
  ];
  const wanted = [
    expected.scenesPerSystem,
    expected.paintsPerVariant,
    expected.perArm.reviewed,
    expected.perArm.color,
    expected.perArm.contrast,
    expected.perArm.rank,
  ];
  if (actual.some((value, index) => value !== wanted[index])) {
    throw new Error(`${arm} v2 denominator mismatch: ${actual.join('/')}`);
  }
}

function assertReproducesExactly(
  values: readonly {baseline: V2ArmEvaluation; candidate: V2ArmEvaluation}[],
): void {
  const expected = JSON.stringify(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    if (JSON.stringify(values[index]) !== expected) {
      throw new Error(`V2 replicate ${index + 1} does not reproduce replicate 1 exactly`);
    }
  }
}

function compareFindings(
  baseline: readonly AutomaticFinding[],
  candidate: readonly AutomaticFinding[],
): FindingDelta[] {
  const left = uniqueFindings(baseline, 'baseline');
  const right = uniqueFindings(candidate, 'candidate');
  const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
  return ids.map((id) => {
    const baselineFinding = left.get(id) ?? null;
    const candidateFinding = right.get(id) ?? null;
    let status: FindingDelta['status'];
    if (baselineFinding === null) status = 'new';
    else if (candidateFinding === null) status = 'resolved';
    else status = failureMargin(candidateFinding) > failureMargin(baselineFinding)
      ? 'worsened'
      : 'unchanged';
    return {id, status, baseline: baselineFinding, candidate: candidateFinding};
  });
}

function uniqueFindings(
  values: readonly AutomaticFinding[],
  label: string,
): Map<string, AutomaticFinding> {
  const result = new Map<string, AutomaticFinding>();
  for (const value of values) {
    if (result.has(value.id)) throw new Error(`Duplicate ${label} finding: ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function failureMargin(value: AutomaticFinding): number {
  return value.rule === 'surface-rank-reversal'
    ? value.observed - value.threshold
    : value.threshold - value.observed;
}
