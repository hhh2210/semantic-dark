import {createHash} from 'node:crypto';
import {evaluateVisionPredictions} from '../../vision';
import type {EvaluatedPrediction} from '../../vision';
import {
  KNOWN_LABELS,
  type BenchmarkMetrics,
  type KnownLabel,
  type LatencyMetrics,
  type OpenSetMetrics,
  type PredictionRow,
} from './types';

const KNOWN = new Set<string>(KNOWN_LABELS);

export function summarizePredictions(
  rows: readonly PredictionRow[],
  latencies: readonly number[] = [],
): BenchmarkMetrics {
  if (rows.length === 0) throw new Error('Cannot summarize an empty prediction set');
  const predictorId = singleValue(rows.map((row) => row.predictor_id), 'predictor_id');
  const scoreSemantics = singleValue(rows.map((row) => row.score_semantics), 'score_semantics');
  const split = singleValue(rows.map((row) => row.target_split), 'target_split');
  const operatingThreshold = singleValue(
    rows.map((row) => row.operating_threshold),
    'operating_threshold',
  );
  const knownRows = rows.filter((row) => KNOWN.has(row.label));
  const evaluated: EvaluatedPrediction<KnownLabel>[] = knownRows.map((row) => ({
    actual: row.label as KnownLabel,
    predicted: row.predicted,
    probabilities: row.probabilities,
  }));
  return {
    schema: 'semantic-dark.benchmark.v1',
    predictorId,
    scoreSemantics,
    split,
    operatingThreshold,
    sampleIdentitySha256: sampleIdentitySha256(rows),
    classification: evaluated.length === 0
      ? null
      : evaluateVisionPredictions(evaluated, {labels: KNOWN_LABELS}),
    openSet: openSetMetrics(rows),
    ...(latencies.length === 0 ? {} : {latency: latencyMetrics(latencies)}),
  };
}

export function openSetMetrics(rows: readonly PredictionRow[]): OpenSetMetrics {
  const known = rows.filter((row) => KNOWN.has(row.label));
  const unknown = rows.filter((row) => row.label === 'unknown');
  const acceptedKnown = known.filter((row) => !row.abstained);
  const correctKnown = acceptedKnown.filter((row) => row.predicted === row.label);
  const unknownFalseAccepts = unknown.filter((row) => !row.abstained).length;
  return {
    knownTotal: known.length,
    knownAccepted: acceptedKnown.length,
    knownCoverage: ratio(acceptedKnown.length, known.length),
    knownSelectiveAccuracy: ratio(correctKnown.length, acceptedKnown.length),
    unknownTotal: unknown.length,
    unknownFalseAccepts,
    unknownFalseAcceptRate: ratio(unknownFalseAccepts, unknown.length),
    overallAbstainRate: ratio(rows.filter((row) => row.abstained).length, rows.length),
  };
}

export function latencyMetrics(values: readonly number[]): LatencyMetrics {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Latencies must be finite non-negative numbers');
  }
  const sorted = [...values].sort((first, second) => first - second);
  const totalMs = sorted.reduce((sum, value) => sum + value, 0);
  return {
    scope: 'pixel-classifier-only',
    sampleCount: sorted.length,
    totalMs,
    meanMs: sorted.length === 0 ? null : totalMs / sorted.length,
    p95Ms: sorted.length === 0 ? null : sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

function sampleIdentitySha256(rows: readonly PredictionRow[]): string {
  const identities = rows.map((row) => [
    row.id,
    row.label,
    row.source_group,
    row.sha256,
    row.raw_sha256,
  ].join('\0')).sort();
  return createHash('sha256').update(identities.join('\n')).digest('hex');
}

function singleValue<Value>(values: readonly Value[], name: string): Value {
  const unique = new Set(values);
  if (unique.size !== 1) throw new Error(`Prediction rows have mixed ${name}`);
  return values[0]!;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
