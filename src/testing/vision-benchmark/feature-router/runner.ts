import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareScratchOutput, writeJson, writeJsonLines} from '../../artifacts';
import {assertCorpusDisjoint, loadCorpusManifests, readVerifiedPng} from '../manifest';
import {summarizePredictions} from '../metrics';
import {
  assertFormalPredictionCoverage,
  assertPredictionSetsDisjoint,
  parsePredictionRows,
} from '../prediction';
import {applyConfidenceThreshold, calibrateConfidenceThreshold} from '../threshold';
import {KNOWN_LABELS, type KnownLabel, type PredictionRow} from '../types';
import {FEATURE_NAMES, imageFeatureVector} from './features';
import {
  DEFAULT_TRAINING_CONFIG,
  featureRouterParameterCount,
  predictFeatureRouter,
  trainFeatureRouter,
} from './linear';
import type {
  FeatureRouterExample,
  FeatureRouterExperimentReport,
  FeatureRouterModel,
  FeatureRouterTrainingConfig,
} from './types';

export interface FeatureRouterRunOptions {
  manifests: readonly string[];
  output: string;
  targetUnknownFalseAcceptRate?: number;
  training?: Partial<FeatureRouterTrainingConfig>;
}

export async function runFeatureRouterExperiment(
  options: FeatureRouterRunOptions,
): Promise<FeatureRouterExperimentReport> {
  if (options.manifests.length === 0) throw new Error('At least one manifest is required');
  const targetFar = options.targetUnknownFalseAcceptRate ?? 0.05;
  if (!Number.isFinite(targetFar) || targetFar < 0 || targetFar > 1) {
    throw new RangeError('targetUnknownFalseAcceptRate must be in [0, 1]');
  }
  const output = await prepareScratchOutput(options.output, 'Feature-router');
  const located = await loadCorpusManifests(options.manifests);
  assertCorpusDisjoint(located);
  const known = new Set<string>(KNOWN_LABELS);
  const train = located.filter(({record}) =>
    record.target_split === 'train' && known.has(record.label));
  const validation = located.filter(({record}) => record.target_split === 'val');
  const test = located.filter(({record}) => record.target_split === 'test');
  if (validation.length === 0 || test.length === 0) {
    throw new Error('Feature-router experiment requires non-empty val and test splits');
  }

  const examples: FeatureRouterExample[] = [];
  for (const item of train) {
    const image = await readVerifiedPng(item);
    examples.push({
      label: item.record.label as KnownLabel,
      features: imageFeatureVector(image),
    });
  }
  const training = {...DEFAULT_TRAINING_CONFIG, ...options.training};
  const model = trainFeatureRouter(examples, training);
  const validationOutput = await predictSplit(model, validation);
  const testOutput = await predictSplit(model, test);
  const validationRows = parsePredictionRows(validationOutput.rows, 'val');
  const testRows = parsePredictionRows(testOutput.rows, 'test');
  assertFormalPredictionCoverage(validationRows, 'val');
  assertFormalPredictionCoverage(testRows, 'test');
  assertPredictionSetsDisjoint(validationRows, testRows);

  const calibration = calibrateConfidenceThreshold(validationRows, targetFar);
  const thresholdedValidation = applyConfidenceThreshold(validationRows, calibration.threshold);
  const thresholdedTest = applyConfidenceThreshold(testRows, calibration.threshold);
  const rawValidationMetrics = summarizePredictions(validationRows, validationOutput.latencies);
  const rawTestMetrics = summarizePredictions(testRows, testOutput.latencies);
  const validationMetrics = summarizePredictions(
    thresholdedValidation,
    validationOutput.latencies,
  );
  const testMetrics = summarizePredictions(thresholdedTest, testOutput.latencies);

  const modelText = `${JSON.stringify(model)}\n`;
  const modelJsonBytes = Buffer.byteLength(modelText);
  const report: FeatureRouterExperimentReport = {
    schema: 'semantic-dark.feature-router-experiment.v1',
    predictorId: model.predictorId,
    featureCount: FEATURE_NAMES.length,
    parameterCount: featureRouterParameterCount(model),
    modelJsonBytes,
    trainingKnownSamples: examples.length,
    validationSamples: validationRows.length,
    testSamples: testRows.length,
    targetUnknownFalseAcceptRate: targetFar,
    selectedThreshold: calibration.threshold,
    validationUnknownFalseAcceptRate: validationMetrics.openSet.unknownFalseAcceptRate,
    testUnknownFalseAcceptRate: testMetrics.openSet.unknownFalseAcceptRate,
    validationMacroF1: validationMetrics.classification?.macroF1 ?? null,
    testMacroF1: testMetrics.classification?.macroF1 ?? null,
    validationPixelOnlyLatency: latencySummary(validationMetrics),
    testPixelOnlyLatency: latencySummary(testMetrics),
  };

  await Promise.all([
    writeFile(path.join(output, 'model.json'), modelText, 'utf8'),
    writeJsonLines(validationRows, path.join(output, 'raw-val-predictions.jsonl')),
    writeJsonLines(testRows, path.join(output, 'raw-test-predictions.jsonl')),
    writeJsonLines(thresholdedTest, path.join(output, 'calibrated-test-predictions.jsonl')),
    writeJson(calibration, path.join(output, 'calibration.json')),
    writeJson(rawValidationMetrics, path.join(output, 'raw-val-metrics.json')),
    writeJson(rawTestMetrics, path.join(output, 'raw-test-metrics.json')),
    writeJson(validationMetrics, path.join(output, 'calibrated-val-metrics.json')),
    writeJson(testMetrics, path.join(output, 'calibrated-test-metrics.json')),
    writeJson(report, path.join(output, 'experiment.json')),
  ]);
  return report;
}

async function predictSplit(
  model: FeatureRouterModel,
  items: Awaited<ReturnType<typeof loadCorpusManifests>>,
): Promise<{rows: PredictionRow[]; latencies: number[]}> {
  const rows: PredictionRow[] = [];
  const latencies: number[] = [];
  for (const item of items) {
    const image = await readVerifiedPng(item);
    const startedAt = performance.now();
    const prediction = predictFeatureRouter(model, imageFeatureVector(image));
    latencies.push(performance.now() - startedAt);
    rows.push({
      schema: 'semantic-dark.prediction.v2',
      id: item.record.id,
      source: item.record.source,
      source_group: item.record.source_group,
      sha256: item.record.sha256,
      raw_sha256: item.record.raw_sha256,
      label: item.record.label,
      target_split: item.record.target_split,
      probabilities: prediction.probabilities,
      raw_predicted: prediction.predicted,
      acceptance_score: prediction.acceptanceScore,
      score_semantics: model.scoreSemantics,
      predictor_id: model.predictorId,
      operating_threshold: 0,
      predicted: prediction.predicted,
      abstained: false,
    });
  }
  return {rows, latencies};
}

function latencySummary(metrics: ReturnType<typeof summarizePredictions>): {
  meanMs: number | null;
  p95Ms: number | null;
} {
  return {
    meanMs: metrics.latency?.meanMs ?? null,
    p95Ms: metrics.latency?.p95Ms ?? null,
  };
}
