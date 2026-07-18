import {
  MINIMUM_SURFACE_SEPARATION,
  contrastRatio,
} from '../../color';
import {
  PAIRED_THEME_COLOR_DISTANCE_CAP,
  PAIRED_THEME_CONTRAST_LOG2_CAP,
  aggregatePairedThemeMetrics,
  colorDistanceLoss,
  contrastConsistencyLoss,
  surfaceRankLoss,
} from './metrics';
import {effectivePaintMap, type PairedThemeObservationMatrix} from './observations';
import {
  accentHueSummary,
  compare,
  contrastFinding,
  decisionLoss,
  denominators,
  labLightness,
  oklabDistance,
  rankFinding,
  rankLossRecord,
  relation,
  required,
  secondary,
} from './evaluation-support';
import type {
  AutomaticFinding,
  ColorMetricRow,
  ContrastMetricRow,
  PairedThemeSystemEvaluation,
  RankMetricRow,
} from './evaluation-types';
import type {PairedThemeMetricConfig, SceneDefinition} from './types';

export type {
  AutomaticFinding,
  ColorMetricRow,
  ContrastMetricRow,
  PairedThemeSystemEvaluation,
  RankMetricRow,
} from './evaluation-types';

/** Score one design system independently; this M1 endpoint has no tuned candidate. */
export function evaluatePairedThemeSystem(
  matrix: PairedThemeObservationMatrix,
  scenes: readonly SceneDefinition[],
  metric: PairedThemeMetricConfig,
): PairedThemeSystemEvaluation {
  assertMetricImplementation(metric);
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
        id: `D/${matrix.system}/${scene.id}/${paint.id}`,
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
        id: `C/${matrix.system}/${scene.id}/${paint.id}`,
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
      if (!candidatePass) findings.push(contrastFinding(matrix.system, scene.id, paint.id,
        paint.contrastKind, candidateRatio, floor));
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
      const separationPass = separation + metric.comparisonEpsilon >= metric.surfaceSeparationFloor;
      rankRows.push({
        id: `R/${matrix.system}/${scene.id}/${pair.id}`,
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
      if (!separationPass) findings.push(rankFinding(matrix.system, scene.id, pair.id,
        'surface-separation', separation, metric.surfaceSeparationFloor));
      if (loss === 1) findings.push(rankFinding(matrix.system, scene.id, pair.id,
        'surface-rank-reversal', loss, 0));
    }
  }

  const [score] = aggregatePairedThemeMetrics({
    color: colorRows.map(decisionLoss),
    contrast: contrastRows.map(decisionLoss),
    rank: rankRows.map(rankLossRecord),
  });
  if (!score || score.system !== matrix.system) throw new Error('Metric system join failed');
  const accent = accentHueSummary(colorRows, candidate, authored, metric.accentChromaThreshold);
  return {
    schema: 'semantic-dark.paired-theme-system-evaluation.v1',
    system: matrix.system,
    split: matrix.split,
    status: 'valid',
    counts: denominators(scenes, matrix, colorRows, contrastRows, rankRows),
    rows: {color: colorRows, contrast: contrastRows, rank: rankRows},
    primary: {
      ...score,
      relativeErrorReduction: {
        formula: '(E_baseline-E_candidate)/E_baseline',
        baselineE: score.e,
        candidateE: null,
        value: null,
        status: 'not-applicable-baseline-only',
      },
    },
    secondary: secondary(contrastRows, rankRows, findings, accent),
    findings: findings.sort((a, b) => compare(a.id, b.id)),
    manualSentinel: {status: 'not-run-in-m1-pair-evaluation', h3: null, h2: null, h1: null},
  };
}

function assertMetricImplementation(metric: PairedThemeMetricConfig): void {
  const expected = [
    [metric.deltaEOkCap, PAIRED_THEME_COLOR_DISTANCE_CAP, 'deltaEOkCap'],
    [metric.contrastLog2Cap, PAIRED_THEME_CONTRAST_LOG2_CAP, 'contrastLog2Cap'],
    [metric.textContrastFloor, 4.5, 'textContrastFloor'],
    [metric.nonTextContrastFloor, 3, 'nonTextContrastFloor'],
    [metric.surfaceSeparationFloor, MINIMUM_SURFACE_SEPARATION, 'surfaceSeparationFloor'],
  ] as const;
  for (const [actual, requiredValue, name] of expected) {
    if (actual !== requiredValue) throw new Error(`${name} differs from evaluator v1`);
  }
  const weights = metric.componentWeights;
  if (Math.abs(weights.color - 1 / 3) > 1e-12 ||
      Math.abs(weights.contrast - 1 / 3) > 1e-12 ||
      Math.abs(weights.rank - 1 / 3) > 1e-12) {
    throw new Error('Metric weights differ from the equal-weight evaluator');
  }
}
