import {describe, expect, it} from 'vitest';
import {
  FEATURE_NAMES,
  featureRouterParameterCount,
  imageFeatureVector,
  predictFeatureRouter,
  trainFeatureRouter,
} from '../../src/testing/vision-benchmark/feature-router';
import {parsePredictionRows} from '../../src/testing/vision-benchmark/prediction';
import {KNOWN_LABELS, type KnownLabel} from '../../src/testing/vision-benchmark/types';

function vector(label: KnownLabel, jitter = 0): number[] {
  const values = Array.from({length: FEATURE_NAMES.length}, () => jitter);
  values[KNOWN_LABELS.indexOf(label)] = 2 + jitter;
  return values;
}

describe('feature-router ablation', () => {
  it('projects the shared bounded-cost image features into 20 finite values', () => {
    const features = imageFeatureVector({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        255, 255, 255, 255,
        0, 0, 0, 0,
      ]),
    });
    expect(FEATURE_NAMES).toHaveLength(20);
    expect(features).toHaveLength(20);
    expect(features.every(Number.isFinite)).toBe(true);
    expect(features[0]).toBeCloseTo(Math.log(2));
    expect(features[2]).toBeCloseTo(0.5);
  });

  it('trains the same tiny linear router and OOD geometry for the same seed', () => {
    const examples = KNOWN_LABELS.flatMap((label) => [
      {label, features: vector(label, -0.05)},
      {label, features: vector(label, 0.05)},
    ]);
    const config = {seed: 7, epochs: 250, learningRate: 0.04, l2: 0.0001};
    const first = trainFeatureRouter(examples, config);
    const second = trainFeatureRouter(examples, config);
    expect(first).toEqual(second);
    expect(featureRouterParameterCount(first)).toBe(284);
    for (const label of KNOWN_LABELS) {
      const prediction = predictFeatureRouter(first, vector(label));
      expect(prediction.predicted).toBe(label);
      expect(Object.values(prediction.probabilities).reduce((sum, value) => sum + value, 0))
        .toBeCloseTo(1, 12);
    }
  });

  it('emits values accepted by the strict prediction v2 parser', () => {
    const examples = KNOWN_LABELS.map((label) => ({label, features: vector(label)}));
    const model = trainFeatureRouter(
      examples,
      {seed: 1, epochs: 120, learningRate: 0.03, l2: 0},
    );
    const prediction = predictFeatureRouter(model, vector('diagram'));
    const [parsed] = parsePredictionRows([{
      schema: 'semantic-dark.prediction.v2',
      id: 'feature-router-fixture',
      source: 'unit-test',
      source_group: 'unit-test-group',
      sha256: 'a'.repeat(64),
      raw_sha256: 'b'.repeat(64),
      label: 'diagram',
      target_split: 'val',
      probabilities: prediction.probabilities,
      raw_predicted: prediction.predicted,
      acceptance_score: prediction.acceptanceScore,
      score_semantics: model.scoreSemantics,
      predictor_id: model.predictorId,
      operating_threshold: 0,
      predicted: prediction.predicted,
      abstained: false,
    }], 'val');
    expect(parsed?.raw_predicted).toBe('diagram');
  });
});
