import {homedir} from 'node:os';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {
  classifyVisualResource,
  normalizeClassScores,
} from '../../vision';
import {assertCorpusDisjoint, loadCorpusManifests, readVerifiedPng} from './manifest';
import {summarizePredictions} from './metrics';
import {combineGateAndExpertPredictions} from './hybrid';
import {
  assertFormalPredictionCoverage,
  assertPredictionSetsDisjoint,
  readPredictionFile,
} from './prediction';
import {applyConfidenceThreshold, calibrateConfidenceThreshold} from './threshold';
import {
  KNOWN_LABELS,
  type BenchmarkMetrics,
  type KnownLabel,
  type PredictionRow,
  type TargetSplit,
  type ThresholdCalibration,
} from './types';

export interface HeuristicBenchmarkOptions {
  manifests: readonly string[];
  output: string;
  split: TargetSplit;
  threshold: number;
}

export async function runHeuristicBenchmark(
  options: HeuristicBenchmarkOptions,
): Promise<BenchmarkMetrics> {
  if (options.manifests.length === 0) throw new Error('At least one manifest is required');
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1) {
    throw new RangeError('threshold must be in [0, 1]');
  }
  const output = await prepareOutput(options.output);
  const allRecords = await loadCorpusManifests(options.manifests);
  assertCorpusDisjoint(allRecords);
  const records = allRecords.filter((item) => item.record.target_split === options.split);
  if (records.length === 0) throw new Error(`No corpus rows for split ${options.split}`);
  const rows: PredictionRow[] = [];
  const latencies: number[] = [];
  for (const item of records) {
    const image = await readVerifiedPng(item);
    const startedAt = performance.now();
    const classification = classifyVisualResource(image, {maxSamples: 4096});
    latencies.push(performance.now() - startedAt);
    const scores = {
      photo: classification.scores.photo,
      icon: classification.scores.icon,
      diagram: classification.scores.diagram,
      screenshot: classification.scores.screenshot,
    };
    if (scores.photo + scores.icon + scores.diagram + scores.screenshot === 0) {
      scores.photo = scores.icon = scores.diagram = scores.screenshot = 1;
    }
    const probabilities = normalizeClassScores(KNOWN_LABELS, scores);
    const rawPredicted = classification.kind === 'unknown'
      ? null
      : classification.kind;
    const accepted = rawPredicted !== null &&
      classification.confidence >= options.threshold;
    rows.push({
      schema: 'semantic-dark.prediction.v2',
      id: item.record.id,
      source: item.record.source,
      source_group: item.record.source_group,
      sha256: item.record.sha256,
      raw_sha256: item.record.raw_sha256,
      label: item.record.label,
      target_split: item.record.target_split,
      probabilities,
      raw_predicted: rawPredicted,
      acceptance_score: classification.confidence,
      score_semantics: 'heuristic-routing-confidence-v1',
      predictor_id: 'semantic-dark-heuristic-v1',
      operating_threshold: options.threshold,
      predicted: accepted ? rawPredicted as KnownLabel : null,
      abstained: !accepted,
    });
  }
  if (options.split === 'val' || options.split === 'test') {
    assertFormalPredictionCoverage(rows, options.split);
  }
  await writePredictions(rows, path.join(output, 'predictions.jsonl'));
  const metrics = summarizePredictions(rows, latencies);
  await writeJson(metrics, path.join(output, 'metrics.json'));
  return metrics;
}

export async function summarizePredictionFile(
  predictions: string,
  outputValue: string,
): Promise<BenchmarkMetrics> {
  const output = await prepareOutput(outputValue);
  const rows = await readPredictionFile(predictions);
  const metrics = summarizePredictions(rows);
  await writeJson(metrics, path.join(output, 'metrics.json'));
  return metrics;
}

export async function runCalibratedBenchmark(
  validationPredictions: string,
  testPredictions: string,
  outputValue: string,
  targetUnknownFalseAcceptRate = 0.05,
): Promise<{calibration: ThresholdCalibration; test: BenchmarkMetrics}> {
  const output = await prepareOutput(outputValue);
  const validationRows = await readPredictionFile(validationPredictions, 'val');
  const testRows = await readPredictionFile(testPredictions, 'test');
  assertFormalPredictionCoverage(validationRows, 'val');
  assertFormalPredictionCoverage(testRows, 'test');
  assertPredictionSetsDisjoint(validationRows, testRows);
  const calibration = calibrateConfidenceThreshold(
    validationRows,
    targetUnknownFalseAcceptRate,
  );
  const thresholdedTest = applyConfidenceThreshold(testRows, calibration.threshold);
  const test = summarizePredictions(thresholdedTest);
  await writePredictions(thresholdedTest, path.join(output, 'predictions.jsonl'));
  await writeJson(calibration, path.join(output, 'calibration.json'));
  await writeJson(test, path.join(output, 'metrics.json'));
  return {calibration, test};
}

export async function runHybridBenchmark(
  gatePredictions: string,
  expertPredictions: string,
  outputValue: string,
): Promise<BenchmarkMetrics> {
  const output = await prepareOutput(outputValue);
  const gateRows = await readPredictionFile(gatePredictions);
  const expertRows = await readPredictionFile(expertPredictions);
  const rows = combineGateAndExpertPredictions(gateRows, expertRows);
  if (rows[0]!.target_split === 'val' || rows[0]!.target_split === 'test') {
    assertFormalPredictionCoverage(rows, rows[0]!.target_split);
  }
  const metrics = summarizePredictions(rows);
  await writePredictions(rows, path.join(output, 'predictions.jsonl'));
  await writeJson(metrics, path.join(output, 'metrics.json'));
  return metrics;
}

async function prepareOutput(value: string): Promise<string> {
  const scratch = path.resolve(homedir(), 'scratch-data');
  const output = path.resolve(value.replace(/^~(?=$|\/)/, homedir()));
  if (output === scratch || !output.startsWith(`${scratch}${path.sep}`)) {
    throw new Error(`Benchmark output must be a subdirectory of ${scratch}`);
  }
  await mkdir(output, {recursive: true});
  return output;
}

async function writePredictions(rows: readonly PredictionRow[], destination: string): Promise<void> {
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(destination, `${text}\n`, 'utf8');
}

async function writeJson(value: unknown, destination: string): Promise<void> {
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
