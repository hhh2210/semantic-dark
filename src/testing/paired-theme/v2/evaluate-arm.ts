import {MINIMUM_SURFACE_SEPARATION, contrastRatio} from '../../../color';
import {
  PAIRED_THEME_COLOR_DISTANCE_CAP,
  PAIRED_THEME_CONTRAST_LOG2_CAP,
  colorDistanceLoss,
  composePairScore,
  contrastConsistencyLoss,
  surfaceRankLoss,
} from '../metrics';
import {
  aggregateDecisionLossesForRegistry,
  aggregateRankLossesForRegistry,
} from '../metric-reducers';
import {effectivePaintMap, type PairedThemeObservationMatrix} from '../observations';
import {
  accentHueSummary,
  compare,
  contrastFinding,
  denominators,
  labLightness,
  oklabDistance,
  rankFinding,
  relation,
  required,
  secondary,
} from '../evaluation-support';
import type {
  AutomaticFinding,
  ColorMetricRow,
  ContrastMetricRow,
  PairedThemeSystemEvaluation,
  RankMetricRow,
} from '../evaluation-types';
import type {SceneDefinition} from '../types';
import {
  assertValidatedV2EvaluationContract,
  registeredSystemSet,
  type V2MetricConfig,
  type ValidatedV2EvaluationContract,
} from './contract';

export type V2ColorMetricRow = Omit<ColorMetricRow, 'system'> & {system: string};
export type V2ContrastMetricRow = Omit<ContrastMetricRow, 'system'> & {system: string};
export type V2RankMetricRow = Omit<RankMetricRow, 'system'> & {system: string};

export interface V2ArmEvaluation {
  schema: 'semantic-dark.paired-theme-arm-evaluation.v2';
  system: string;
  split: 'development' | 'held-out';
  status: 'valid';
  counts: Omit<PairedThemeSystemEvaluation['counts'], 'observations'>;
  rows: {
    color: readonly V2ColorMetricRow[];
    contrast: readonly V2ContrastMetricRow[];
    rank: readonly V2RankMetricRow[];
  };
  primary: {d: number; c: number; r: number; e: number; pairScore: number};
  secondary: PairedThemeSystemEvaluation['secondary'];
  findings: readonly AutomaticFinding[];
}

/** Score one v2 arm while the validated contract supplies the allowed system registry. */
export function evaluateV2Arm(
  matrix: PairedThemeObservationMatrix,
  scenes: readonly SceneDefinition[],
  contract: ValidatedV2EvaluationContract,
): V2ArmEvaluation {
  assertValidatedV2EvaluationContract(contract);
  const metric = contract.metric;
  const systems = registeredSystemSet(contract);
  assertMetricImplementation(metric);
  const system = String(matrix.system);
  const authored = effectivePaintMap(matrix, 'authored-dark');
  const candidate = effectivePaintMap(matrix, 'baseline-candidate');
  const colorRows: ColorMetricRow[] = [];
  const contrastRows: ContrastMetricRow[] = [];
  const rankRows: RankMetricRow[] = [];
  const findings: AutomaticFinding[] = [];

  for (const scene of [...scenes].sort((a, b) => compare(a.id, b.id))) {
    for (const paint of [...scene.paints].sort((a, b) => compare(a.id, b.id))) {
      if (!paint.reviewed) continue;
      const candidatePaint = required(candidate, paint.id, 'candidate');
      const authoredPaint = required(authored, paint.id, 'authored dark');
      const deltaOk = oklabDistance(candidatePaint.effectiveColor, authoredPaint.effectiveColor);
      colorRows.push({
        id: `D/${system}/${scene.id}/${paint.id}`,
        system: matrix.system,
        sceneId: scene.id,
        role: paint.role,
        decisionId: paint.id,
        deltaOk,
        cap: PAIRED_THEME_COLOR_DISTANCE_CAP,
        loss: colorDistanceLoss(candidatePaint.effectiveColor, authoredPaint.effectiveColor),
      });
      if (paint.contrastKind === 'none') continue;
      if (!paint.backdropPaintId || !candidatePaint.backdropEffectiveColor ||
          !authoredPaint.backdropEffectiveColor) {
        throw new Error(`Contrast paint ${paint.id} has no effective backdrop`);
      }
      const candidateRatio = contrastRatio(
        candidatePaint.effectiveColor,
        candidatePaint.backdropEffectiveColor,
      );
      const authoredRatio = contrastRatio(
        authoredPaint.effectiveColor,
        authoredPaint.backdropEffectiveColor,
      );
      const absoluteLog2Error = Math.abs(Math.log2(candidateRatio / authoredRatio));
      const floor = paint.contrastKind === 'text'
        ? metric.textContrastFloor
        : metric.nonTextContrastFloor;
      const candidatePass = candidateRatio + metric.comparisonEpsilon >= floor;
      contrastRows.push({
        id: `C/${system}/${scene.id}/${paint.id}`,
        system: matrix.system,
        sceneId: scene.id,
        role: paint.role,
        decisionId: paint.id,
        contrastKind: paint.contrastKind,
        backdropPaintId: paint.backdropPaintId,
        candidateRatio,
        authoredRatio,
        absoluteLog2Error,
        cap: PAIRED_THEME_CONTRAST_LOG2_CAP,
        loss: contrastConsistencyLoss(candidateRatio, authoredRatio),
        floor,
        candidatePass,
      });
      if (!candidatePass) findings.push(contrastFinding(
        system, scene.id, paint.id, paint.contrastKind, candidateRatio, floor,
      ));
    }

    for (const pair of [...scene.surfacePairs].sort((a, b) => compare(a.id, b.id))) {
      const candidateLower = required(candidate, pair.lowerPaintId, 'candidate lower');
      const candidateUpper = required(candidate, pair.upperPaintId, 'candidate upper');
      const authoredLower = required(authored, pair.lowerPaintId, 'authored lower');
      const authoredUpper = required(authored, pair.upperPaintId, 'authored upper');
      const candidateDeltaL = labLightness(candidateUpper.effectiveColor) -
        labLightness(candidateLower.effectiveColor);
      const authoredDeltaL = labLightness(authoredUpper.effectiveColor) -
        labLightness(authoredLower.effectiveColor);
      const loss = surfaceRankLoss(
        candidateLower.effectiveColor,
        candidateUpper.effectiveColor,
        authoredLower.effectiveColor,
        authoredUpper.effectiveColor,
        metric.rankTieEpsilon,
      );
      const separation = contrastRatio(
        candidateUpper.effectiveColor,
        candidateLower.effectiveColor,
      );
      const separationPass = separation + metric.comparisonEpsilon >=
        metric.surfaceSeparationFloor;
      rankRows.push({
        id: `R/${system}/${scene.id}/${pair.id}`,
        system: matrix.system,
        sceneId: scene.id,
        pairId: pair.id,
        lowerPaintId: pair.lowerPaintId,
        upperPaintId: pair.upperPaintId,
        tieEpsilon: metric.rankTieEpsilon,
        candidateDeltaL,
        authoredDeltaL,
        candidateRelation: relation(candidateDeltaL, metric.rankTieEpsilon),
        authoredRelation: relation(authoredDeltaL, metric.rankTieEpsilon),
        loss,
        candidateSeparationRatio: separation,
        separationFloor: metric.surfaceSeparationFloor,
        separationPass,
        inversion: loss === 1,
        tieMismatch: loss === 0.5,
      });
      if (!separationPass) findings.push(rankFinding(
        system, scene.id, pair.id, 'surface-separation', separation,
        metric.surfaceSeparationFloor,
      ));
      if (loss === 1) findings.push(rankFinding(
        system, scene.id, pair.id, 'surface-rank-reversal', loss, 0,
      ));
    }
  }

  const d = onlyLoss(aggregateDecisionLossesForRegistry(
    colorRows.map((row) => ({system, sceneId: row.sceneId, role: row.role,
      decisionId: row.decisionId, loss: row.loss})), systems,
  ), system, 'color');
  const c = onlyLoss(aggregateDecisionLossesForRegistry(
    contrastRows.map((row) => ({system, sceneId: row.sceneId, role: row.role,
      decisionId: row.decisionId, loss: row.loss})), systems,
  ), system, 'contrast');
  const r = onlyLoss(aggregateRankLossesForRegistry(
    rankRows.map((row) => ({system, sceneId: row.sceneId,
      pairId: row.pairId, loss: row.loss})), systems,
  ), system, 'rank');
  const accent = accentHueSummary(colorRows, candidate, authored, metric.accentChromaThreshold);
  const counts = denominators(scenes, matrix, colorRows, contrastRows, rankRows);
  const {observations: _observations, ...armCounts} = counts;
  return {
    schema: 'semantic-dark.paired-theme-arm-evaluation.v2',
    system,
    split: matrix.split,
    status: 'valid',
    counts: armCounts,
    rows: {color: colorRows, contrast: contrastRows, rank: rankRows},
    primary: {d, c, r, ...composePairScore(d, c, r)},
    secondary: secondary(contrastRows, rankRows, findings, accent),
    findings: findings.sort((a, b) => compare(a.id, b.id)),
  };
}

function onlyLoss(
  values: readonly {system: string; loss: number}[],
  system: string,
  component: string,
): number {
  if (values.length !== 1 || values[0]?.system !== system) {
    throw new Error(`V2 ${component} metric system join failed`);
  }
  return values[0].loss;
}

function assertMetricImplementation(metric: V2MetricConfig): void {
  const expected = [
    [metric.deltaEOkCap, PAIRED_THEME_COLOR_DISTANCE_CAP, 'deltaEOkCap'],
    [metric.contrastLog2Cap, PAIRED_THEME_CONTRAST_LOG2_CAP, 'contrastLog2Cap'],
    [metric.textContrastFloor, 4.5, 'textContrastFloor'],
    [metric.nonTextContrastFloor, 3, 'nonTextContrastFloor'],
    [metric.surfaceSeparationFloor, MINIMUM_SURFACE_SEPARATION, 'surfaceSeparationFloor'],
    [metric.rankTieEpsilon, 0.01, 'rankTieEpsilon'],
    [metric.comparisonEpsilon, 0, 'comparisonEpsilon'],
    [metric.accentChromaThreshold, 0.02, 'accentChromaThreshold'],
  ] as const;
  for (const [actual, requiredValue, name] of expected) {
    if (actual !== requiredValue) throw new Error(`${name} differs from evaluator v2`);
  }
  const weights = metric.componentWeights;
  if (Math.abs(weights.color - 1 / 3) > 1e-12 ||
      Math.abs(weights.contrast - 1 / 3) > 1e-12 ||
      Math.abs(weights.rank - 1 / 3) > 1e-12) {
    throw new Error('Metric weights differ from the equal-weight v2 evaluator');
  }
}
