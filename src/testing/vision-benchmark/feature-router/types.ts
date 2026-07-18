import type {KnownLabel} from '../types';

export interface FeatureRouterExample {
  label: KnownLabel;
  features: readonly number[];
}

export interface FeatureRouterTrainingConfig {
  seed: number;
  epochs: number;
  learningRate: number;
  l2: number;
}

export interface FeatureStandardizer {
  mean: number[];
  scale: number[];
}

export interface FeatureRouterModel {
  schema: 'semantic-dark.feature-router.v1';
  predictorId: 'semantic-dark-feature-linear-v1';
  scoreSemantics: 'predicted-class-diagonal-proximity-v1';
  labels: KnownLabel[];
  featureNames: string[];
  standardizer: FeatureStandardizer;
  weights: number[][];
  bias: number[];
  oodGate: {
    centroids: number[][];
    scales: number[][];
  };
  training: FeatureRouterTrainingConfig & {
    sampleCount: number;
    finalLoss: number;
  };
}

export interface FeatureRouterPrediction {
  probabilities: Record<KnownLabel, number>;
  predicted: KnownLabel;
  acceptanceScore: number;
}

export interface FeatureRouterExperimentReport {
  schema: 'semantic-dark.feature-router-experiment.v1';
  predictorId: FeatureRouterModel['predictorId'];
  featureCount: number;
  parameterCount: number;
  modelJsonBytes: number;
  trainingKnownSamples: number;
  validationSamples: number;
  testSamples: number;
  targetUnknownFalseAcceptRate: number;
  selectedThreshold: number;
  validationUnknownFalseAcceptRate: number | null;
  testUnknownFalseAcceptRate: number | null;
  validationMacroF1: number | null;
  testMacroF1: number | null;
  validationPixelOnlyLatency: {
    meanMs: number | null;
    p95Ms: number | null;
  };
  testPixelOnlyLatency: {
    meanMs: number | null;
    p95Ms: number | null;
  };
}
