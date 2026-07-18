import {summarizePredictions} from './metrics';
import type {
  PredictionRow,
  ThresholdCalibration,
  ThresholdCurvePoint,
} from './types';

export function applyConfidenceThreshold(
  rows: readonly PredictionRow[],
  threshold: number,
): PredictionRow[] {
  assertThreshold(threshold);
  return rows.map((row) => {
    const accepted = row.raw_predicted !== null && row.acceptance_score >= threshold;
    return {
      ...row,
      operating_threshold: threshold,
      predicted: accepted ? row.raw_predicted : null,
      abstained: !accepted,
    };
  });
}

/** Select a threshold on validation only, under an explicit unknown-FAR budget. */
export function calibrateConfidenceThreshold(
  validationRows: readonly PredictionRow[],
  targetUnknownFalseAcceptRate = 0.05,
): ThresholdCalibration {
  assertThreshold(targetUnknownFalseAcceptRate);
  const rawUnknown = validationRows.filter((row) => row.label === 'unknown');
  if (rawUnknown.length === 0) {
    throw new Error('Threshold calibration requires validation unknown/OOD rows');
  }
  const candidates = candidateThresholds(validationRows);
  const evaluated = candidates.map((threshold) => {
    const metrics = summarizePredictions(applyConfidenceThreshold(validationRows, threshold));
    return {threshold, metrics};
  });
  const feasible = evaluated.filter(({metrics}) =>
    (metrics.openSet.unknownFalseAcceptRate ?? 1) <= targetUnknownFalseAcceptRate,
  );
  if (feasible.length === 0) throw new Error('No threshold satisfies the requested OOD FAR');
  feasible.sort((left, right) => {
    const macroDifference = (right.metrics.classification?.macroF1 ?? -1) -
      (left.metrics.classification?.macroF1 ?? -1);
    if (macroDifference !== 0) return macroDifference;
    const coverageDifference = (right.metrics.openSet.knownCoverage ?? -1) -
      (left.metrics.openSet.knownCoverage ?? -1);
    return coverageDifference || left.threshold - right.threshold;
  });
  const best = feasible[0]!;
  const curve: ThresholdCurvePoint[] = evaluated.map(({threshold, metrics}) => ({
    threshold,
    macroF1: metrics.classification?.macroF1 ?? null,
    knownCoverage: metrics.openSet.knownCoverage,
    unknownFalseAcceptRate: metrics.openSet.unknownFalseAcceptRate,
  }));
  return {
    schema: 'semantic-dark.threshold-calibration.v1',
    targetUnknownFalseAcceptRate,
    threshold: best.threshold,
    validation: best.metrics,
    curve,
  };
}

function candidateThresholds(rows: readonly PredictionRow[]): number[] {
  const values = new Set<number>([0, 1]);
  for (const row of rows) {
    assertThreshold(row.acceptance_score);
    values.add(row.acceptance_score);
    values.add(Math.min(
      1,
      row.acceptance_score + Math.max(Number.EPSILON, row.acceptance_score * Number.EPSILON),
    ));
  }
  return [...values].sort((first, second) => first - second);
}

function assertThreshold(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('threshold must be in [0, 1]');
  }
}
