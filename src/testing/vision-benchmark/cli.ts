import {
  runCalibratedBenchmark,
  runHeuristicBenchmark,
  runHybridBenchmark,
  summarizePredictionFile,
} from './runner';
import type {TargetSplit} from './types';

interface ParsedArguments {
  manifests: string[];
  output?: string;
  predictions?: string;
  calibrationPredictions?: string;
  testPredictions?: string;
  gatePredictions?: string;
  expertPredictions?: string;
  split: TargetSplit;
  threshold: number;
  targetFar: number;
}

export async function main(arguments_: readonly string[]): Promise<void> {
  const argumentsValue = parseArguments(arguments_);
  if (!argumentsValue.output) throw new Error('--output is required');
  const metrics = argumentsValue.gatePredictions && argumentsValue.expertPredictions
    ? await runHybridBenchmark(
      argumentsValue.gatePredictions,
      argumentsValue.expertPredictions,
      argumentsValue.output,
    )
    : argumentsValue.calibrationPredictions && argumentsValue.testPredictions
    ? await runCalibratedBenchmark(
      argumentsValue.calibrationPredictions,
      argumentsValue.testPredictions,
      argumentsValue.output,
      argumentsValue.targetFar,
    )
    : argumentsValue.predictions
      ? await summarizePredictionFile(argumentsValue.predictions, argumentsValue.output)
      : await runHeuristicBenchmark({
      manifests: argumentsValue.manifests,
      output: argumentsValue.output,
      split: argumentsValue.split,
      threshold: argumentsValue.threshold,
    });
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
}

function parseArguments(values: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    manifests: [],
    split: 'test',
    threshold: 0.58,
    targetFar: 0.05,
  };
  for (let index = 0; index < values.length; index++) {
    const flag = values[index]!;
    const value = values[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--manifest') parsed.manifests.push(value);
    else if (flag === '--output') parsed.output = value;
    else if (flag === '--predictions') parsed.predictions = value;
    else if (flag === '--calibration-predictions') parsed.calibrationPredictions = value;
    else if (flag === '--test-predictions') parsed.testPredictions = value;
    else if (flag === '--gate-predictions') parsed.gatePredictions = value;
    else if (flag === '--expert-predictions') parsed.expertPredictions = value;
    else if (flag === '--threshold') parsed.threshold = Number(value);
    else if (flag === '--target-far') parsed.targetFar = Number(value);
    else if (flag === '--split' && ['train', 'val', 'test'].includes(value)) {
      parsed.split = value as TargetSplit;
    } else {
      throw new Error(`Unknown or invalid argument: ${flag}`);
    }
  }
  if (parsed.predictions && parsed.manifests.length > 0) {
    throw new Error('--predictions and --manifest are mutually exclusive');
  }
  if (Boolean(parsed.calibrationPredictions) !== Boolean(parsed.testPredictions)) {
    throw new Error('--calibration-predictions and --test-predictions must be used together');
  }
  if (Boolean(parsed.gatePredictions) !== Boolean(parsed.expertPredictions)) {
    throw new Error('--gate-predictions and --expert-predictions must be used together');
  }
  if ((parsed.calibrationPredictions || parsed.testPredictions) &&
      (parsed.predictions || parsed.manifests.length > 0 || parsed.gatePredictions)) {
    throw new Error('calibrated comparison inputs cannot be combined with other modes');
  }
  if (parsed.gatePredictions && (parsed.predictions || parsed.manifests.length > 0)) {
    throw new Error('hybrid inputs cannot be combined with other modes');
  }
  return parsed;
}
