import {KNOWN_LABELS, type KnownLabel} from '../types';
import {FEATURE_NAMES} from './features';
import type {
  FeatureRouterExample,
  FeatureRouterModel,
  FeatureRouterPrediction,
  FeatureRouterTrainingConfig,
  FeatureStandardizer,
} from './types';

export const DEFAULT_TRAINING_CONFIG: FeatureRouterTrainingConfig = {
  seed: 20_260_717,
  epochs: 1_500,
  learningRate: 0.03,
  l2: 0.0001,
};

export function trainFeatureRouter(
  examples: readonly FeatureRouterExample[],
  config: FeatureRouterTrainingConfig = DEFAULT_TRAINING_CONFIG,
): FeatureRouterModel {
  validateTraining(examples, config);
  const standardizer = fitStandardizer(examples.map((example) => example.features));
  const inputs = examples.map((example) => standardize(example.features, standardizer));
  const targets = examples.map((example) => KNOWN_LABELS.indexOf(example.label));
  const oodGate = fitClassGeometry(inputs, targets);
  const parameterCount = KNOWN_LABELS.length * FEATURE_NAMES.length;
  const random = mulberry32(config.seed);
  const weights = Array.from({length: parameterCount}, () => (random() - 0.5) * 0.01);
  const bias = Array.from({length: KNOWN_LABELS.length}, () => 0);
  const firstMoment = new Float64Array(parameterCount + bias.length);
  const secondMoment = new Float64Array(parameterCount + bias.length);
  let finalLoss = Number.POSITIVE_INFINITY;

  for (let epoch = 1; epoch <= config.epochs; epoch++) {
    const gradient = new Float64Array(parameterCount + bias.length);
    let loss = 0;
    for (let sample = 0; sample < inputs.length; sample++) {
      const probabilities = softmax(logits(inputs[sample]!, weights, bias));
      const target = targets[sample]!;
      loss -= Math.log(Math.max(probabilities[target]!, 1e-15));
      for (let label = 0; label < KNOWN_LABELS.length; label++) {
        const error = probabilities[label]! - (label === target ? 1 : 0);
        const offset = label * FEATURE_NAMES.length;
        for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
          gradient[offset + feature]! += error * inputs[sample]![feature]!;
        }
        gradient[parameterCount + label]! += error;
      }
    }
    const inverseCount = 1 / inputs.length;
    for (let index = 0; index < parameterCount; index++) {
      loss += 0.5 * config.l2 * weights[index]! ** 2;
      gradient[index] = gradient[index]! * inverseCount + config.l2 * weights[index]!;
    }
    for (let index = parameterCount; index < gradient.length; index++) {
      gradient[index]! *= inverseCount;
    }
    adamStep(weights, bias, gradient, firstMoment, secondMoment, epoch, config.learningRate);
    finalLoss = loss * inverseCount;
  }

  return {
    schema: 'semantic-dark.feature-router.v1',
    predictorId: 'semantic-dark-feature-linear-v1',
    scoreSemantics: 'predicted-class-diagonal-proximity-v1',
    labels: [...KNOWN_LABELS],
    featureNames: [...FEATURE_NAMES],
    standardizer,
    weights: KNOWN_LABELS.map((_, label) =>
      weights.slice(label * FEATURE_NAMES.length, (label + 1) * FEATURE_NAMES.length)),
    bias,
    oodGate,
    training: {...config, sampleCount: examples.length, finalLoss},
  };
}

export function predictFeatureRouter(
  model: FeatureRouterModel,
  features: readonly number[],
): FeatureRouterPrediction {
  assertModel(model);
  const input = standardize(features, model.standardizer);
  const flatWeights = model.weights.flat();
  const values = softmax(logits(input, flatWeights, model.bias));
  const probabilities = Object.fromEntries(
    KNOWN_LABELS.map((label, index) => [label, values[index]!]),
  ) as Record<KnownLabel, number>;
  let predicted: KnownLabel = KNOWN_LABELS[0];
  for (const label of KNOWN_LABELS.slice(1)) {
    if (probabilities[label] > probabilities[predicted]) predicted = label;
  }
  const labelIndex = KNOWN_LABELS.indexOf(predicted);
  const distance = diagonalDistance(
    input,
    model.oodGate.centroids[labelIndex]!,
    model.oodGate.scales[labelIndex]!,
  );
  return {
    probabilities,
    predicted,
    acceptanceScore: Math.exp(-0.5 * distance),
  };
}

export function featureRouterParameterCount(model: FeatureRouterModel): number {
  return model.weights.reduce((sum, row) => sum + row.length, 0) +
    model.bias.length +
    model.standardizer.mean.length +
    model.standardizer.scale.length +
    model.oodGate.centroids.reduce((sum, row) => sum + row.length, 0) +
    model.oodGate.scales.reduce((sum, row) => sum + row.length, 0);
}

function fitClassGeometry(
  inputs: readonly (readonly number[])[],
  targets: readonly number[],
): FeatureRouterModel['oodGate'] {
  const centroids = KNOWN_LABELS.map(() => Array.from({length: FEATURE_NAMES.length}, () => 0));
  const counts = KNOWN_LABELS.map(() => 0);
  for (let sample = 0; sample < inputs.length; sample++) {
    const label = targets[sample]!;
    counts[label]! += 1;
    for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
      centroids[label]![feature]! += inputs[sample]![feature]!;
    }
  }
  for (let label = 0; label < KNOWN_LABELS.length; label++) {
    for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
      centroids[label]![feature]! /= counts[label]!;
    }
  }
  const variances = KNOWN_LABELS.map(() => Array.from({length: FEATURE_NAMES.length}, () => 0));
  for (let sample = 0; sample < inputs.length; sample++) {
    const label = targets[sample]!;
    for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
      variances[label]![feature]! +=
        (inputs[sample]![feature]! - centroids[label]![feature]!) ** 2 / counts[label]!;
    }
  }
  const scales = variances.map((row) => row.map((variance) => Math.sqrt(variance + 0.25)));
  return {centroids, scales};
}

function diagonalDistance(
  input: readonly number[],
  centroid: readonly number[],
  scale: readonly number[],
): number {
  let squared = 0;
  for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
    squared += ((input[feature]! - centroid[feature]!) / scale[feature]!) ** 2;
  }
  return squared / FEATURE_NAMES.length;
}

function fitStandardizer(vectors: readonly (readonly number[])[]): FeatureStandardizer {
  const count = vectors.length;
  const mean = Array.from({length: FEATURE_NAMES.length}, () => 0);
  for (const vector of vectors) {
    assertVector(vector);
    for (let index = 0; index < mean.length; index++) mean[index]! += vector[index]! / count;
  }
  const scale = Array.from({length: mean.length}, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < scale.length; index++) {
      scale[index]! += (vector[index]! - mean[index]!) ** 2 / count;
    }
  }
  for (let index = 0; index < scale.length; index++) {
    scale[index] = Math.max(Math.sqrt(scale[index]!), 1e-6);
  }
  return {mean, scale};
}

function standardize(vector: readonly number[], standardizer: FeatureStandardizer): number[] {
  assertVector(vector);
  return vector.map((value, index) =>
    (value - standardizer.mean[index]!) / standardizer.scale[index]!);
}

function logits(
  input: readonly number[],
  weights: readonly number[],
  bias: readonly number[],
): number[] {
  return KNOWN_LABELS.map((_, label) => {
    let value = bias[label]!;
    const offset = label * FEATURE_NAMES.length;
    for (let feature = 0; feature < FEATURE_NAMES.length; feature++) {
      value += weights[offset + feature]! * input[feature]!;
    }
    return value;
  });
}

function softmax(values: readonly number[]): number[] {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function adamStep(
  weights: number[],
  bias: number[],
  gradient: Float64Array,
  first: Float64Array,
  second: Float64Array,
  step: number,
  learningRate: number,
): void {
  const beta1 = 0.9;
  const beta2 = 0.999;
  const firstCorrection = 1 - beta1 ** step;
  const secondCorrection = 1 - beta2 ** step;
  for (let index = 0; index < gradient.length; index++) {
    first[index] = beta1 * first[index]! + (1 - beta1) * gradient[index]!;
    second[index] = beta2 * second[index]! + (1 - beta2) * gradient[index]! ** 2;
    const update = learningRate * (first[index]! / firstCorrection) /
      (Math.sqrt(second[index]! / secondCorrection) + 1e-8);
    if (index < weights.length) weights[index]! -= update;
    else bias[index - weights.length]! -= update;
  }
}

function validateTraining(
  examples: readonly FeatureRouterExample[],
  config: FeatureRouterTrainingConfig,
): void {
  if (examples.length === 0) throw new Error('Feature-router training requires known examples');
  const labels = new Set(examples.map((example) => example.label));
  const missing = KNOWN_LABELS.filter((label) => !labels.has(label));
  if (missing.length > 0) throw new Error(`Training is missing labels: ${missing.join(', ')}`);
  if (!Number.isInteger(config.seed)) throw new RangeError('seed must be an integer');
  if (!Number.isInteger(config.epochs) || config.epochs < 1) {
    throw new RangeError('epochs must be a positive integer');
  }
  if (!(config.learningRate > 0) || !(config.l2 >= 0)) {
    throw new RangeError('learningRate must be positive and l2 non-negative');
  }
  for (const example of examples) assertVector(example.features);
}

function assertVector(vector: readonly number[]): void {
  if (vector.length !== FEATURE_NAMES.length || vector.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`Expected ${FEATURE_NAMES.length} finite features`);
  }
}

function assertModel(model: FeatureRouterModel): void {
  if (model.schema !== 'semantic-dark.feature-router.v1' ||
      model.featureNames.join('\0') !== FEATURE_NAMES.join('\0') ||
      model.weights.length !== KNOWN_LABELS.length ||
      model.weights.some((row) => row.length !== FEATURE_NAMES.length) ||
      model.bias.length !== KNOWN_LABELS.length ||
      model.oodGate.centroids.length !== KNOWN_LABELS.length ||
      model.oodGate.scales.length !== KNOWN_LABELS.length ||
      model.oodGate.centroids.some((row) => row.length !== FEATURE_NAMES.length) ||
      model.oodGate.scales.some((row) => row.length !== FEATURE_NAMES.length)) {
    throw new Error('Invalid or incompatible feature-router model');
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}
