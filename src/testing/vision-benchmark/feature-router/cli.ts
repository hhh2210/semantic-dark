import {DEFAULT_TRAINING_CONFIG} from './linear';
import {runFeatureRouterExperiment} from './runner';

interface ParsedArguments {
  manifests: string[];
  output?: string;
  targetFar: number;
  seed: number;
  epochs: number;
  learningRate: number;
  l2: number;
}

export async function main(values: readonly string[]): Promise<void> {
  const parsed = parseArguments(values);
  if (!parsed.output) throw new Error('--output is required');
  const report = await runFeatureRouterExperiment({
    manifests: parsed.manifests,
    output: parsed.output,
    targetUnknownFalseAcceptRate: parsed.targetFar,
    training: {
      seed: parsed.seed,
      epochs: parsed.epochs,
      learningRate: parsed.learningRate,
      l2: parsed.l2,
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArguments(values: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    manifests: [],
    targetFar: 0.05,
    seed: DEFAULT_TRAINING_CONFIG.seed,
    epochs: DEFAULT_TRAINING_CONFIG.epochs,
    learningRate: DEFAULT_TRAINING_CONFIG.learningRate,
    l2: DEFAULT_TRAINING_CONFIG.l2,
  };
  for (let index = 0; index < values.length; index++) {
    const flag = values[index]!;
    const value = values[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--manifest') parsed.manifests.push(value);
    else if (flag === '--output') parsed.output = value;
    else if (flag === '--target-far') parsed.targetFar = Number(value);
    else if (flag === '--seed') parsed.seed = Number(value);
    else if (flag === '--epochs') parsed.epochs = Number(value);
    else if (flag === '--learning-rate') parsed.learningRate = Number(value);
    else if (flag === '--l2') parsed.l2 = Number(value);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return parsed;
}
