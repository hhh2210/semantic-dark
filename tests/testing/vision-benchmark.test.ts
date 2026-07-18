import {describe, expect, it} from 'vitest';
import {
  latencyMetrics,
  openSetMetrics,
  summarizePredictions,
} from '../../src/testing/vision-benchmark/metrics';
import {assertCorpusDisjoint} from '../../src/testing/vision-benchmark/manifest';
import {combineGateAndExpertPredictions} from '../../src/testing/vision-benchmark/hybrid';
import {
  assertPredictionSetsDisjoint,
  parsePredictionRows,
} from '../../src/testing/vision-benchmark/prediction';
import {
  applyConfidenceThreshold,
  calibrateConfidenceThreshold,
} from '../../src/testing/vision-benchmark/threshold';
import type {PredictionRow} from '../../src/testing/vision-benchmark/types';

const probabilities = {
  photo: 0.7,
  icon: 0.1,
  diagram: 0.1,
  screenshot: 0.1,
};

function row(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    schema: 'semantic-dark.prediction.v2',
    id: 'sample',
    source: 'source',
    source_group: 'source-group',
    sha256: 'a'.repeat(64),
    raw_sha256: 'b'.repeat(64),
    label: 'photo',
    target_split: 'test',
    probabilities,
    raw_predicted: 'photo',
    acceptance_score: 0.8,
    score_semantics: 'test-score-v1',
    predictor_id: 'test-predictor',
    operating_threshold: 0.5,
    predicted: 'photo',
    abstained: false,
    ...overrides,
  };
}

describe('vision benchmark metrics', () => {
  it('keeps open-set false accepts separate from known-class metrics', () => {
    const rows = [
      row({id: 'known-correct'}),
      row({id: 'known-abstained', label: 'icon', predicted: null, abstained: true}),
      row({id: 'unknown-accepted', label: 'unknown'}),
      row({id: 'unknown-rejected', label: 'unknown', predicted: null, abstained: true}),
    ];
    expect(openSetMetrics(rows)).toMatchObject({
      knownTotal: 2,
      knownAccepted: 1,
      knownCoverage: 0.5,
      knownSelectiveAccuracy: 1,
      unknownTotal: 2,
      unknownFalseAccepts: 1,
      unknownFalseAcceptRate: 0.5,
    });
    expect(summarizePredictions(rows).classification?.sampleCount).toBe(2);
  });

  it('reports deterministic p95 classifier latency', () => {
    expect(latencyMetrics([3, 1, 2, 100, 4])).toEqual({
      scope: 'pixel-classifier-only',
      sampleCount: 5,
      totalMs: 110,
      meanMs: 22,
      p95Ms: 100,
    });
  });

  it('rejects duplicate normalized image content crossing splits', () => {
    const base = {
      schema: 'semantic-dark.corpus.v1' as const,
      id: 'train-item',
      label: 'photo' as const,
      source: 'train-source',
      source_group: 'train-group',
      target_split: 'train' as const,
      path: 'images/train.png',
      sha256: 'a'.repeat(64),
      raw_sha256: 'b'.repeat(64),
      original_width: 96,
      original_height: 96,
      license: 'MIT',
      revision: 'pin',
    };
    expect(() => assertCorpusDisjoint([
      {record: base, absolutePath: '/tmp/train.png'},
      {
        record: {
          ...base,
          id: 'test-item',
          source: 'test-source',
          source_group: 'test-group',
          target_split: 'test',
          path: 'images/test.png',
        },
        absolutePath: '/tmp/test.png',
      },
    ])).toThrow(/sha256/i);
  });

  it('calibrates on validation OOD without consulting test rows', () => {
    const validation = [
      row({id: 'known-high', target_split: 'val', acceptance_score: 0.9}),
      row({
        id: 'known-low',
        label: 'icon',
        target_split: 'val',
        raw_predicted: 'icon',
        predicted: 'icon',
        acceptance_score: 0.6,
      }),
      row({id: 'ood-high', label: 'unknown', target_split: 'val', acceptance_score: 0.8}),
      row({
        id: 'ood-low',
        label: 'unknown',
        target_split: 'val',
        acceptance_score: 0.4,
        operating_threshold: 0,
      }),
    ];
    const calibration = calibrateConfidenceThreshold(validation, 0);
    expect(calibration.threshold).toBeGreaterThan(0.8);
    const test = applyConfidenceThreshold([
      row({id: 'test-accepted', acceptance_score: 0.95}),
      row({id: 'test-rejected', acceptance_score: 0.7}),
    ], calibration.threshold);
    expect(test.map((item) => item.abstained)).toEqual([false, true]);
  });

  it('recovers a raw prediction when calibration lowers the producer threshold', () => {
    const prethresholded = row({
      operating_threshold: 0.95,
      acceptance_score: 0.9,
      predicted: null,
      abstained: true,
    });
    const [recalibrated] = applyConfidenceThreshold([prethresholded], 0.5);
    expect(recalibrated?.predicted).toBe('photo');
    expect(recalibrated?.abstained).toBe(false);
  });

  it('strictly validates prediction schema and split isolation', () => {
    const validation = parsePredictionRows([
      row({id: 'validation', target_split: 'val'}),
    ], 'val');
    expect(() => parsePredictionRows([
      row({id: 'wrong-split', target_split: 'test'}),
    ], 'val')).toThrow(/expected val/i);
    expect(() => assertPredictionSetsDisjoint(validation, [
      row({id: 'test', source_group: validation[0]!.source_group}),
    ])).toThrow(/leakage/i);
    expect(() => parsePredictionRows([{
      ...row({id: 'bad-threshold'}),
      predicted: null,
      abstained: false,
    }])).toThrow(/disagree/i);
  });

  it('uses heuristic-style rejection while taking the expert class', () => {
    const gate = row({
      raw_predicted: 'screenshot',
      predicted: 'screenshot',
      acceptance_score: 0.8,
    });
    const expert = row({
      raw_predicted: 'diagram',
      predicted: 'diagram',
      probabilities: {...probabilities, photo: 0.1, diagram: 0.7},
      predictor_id: 'expert',
    });
    const [hybrid] = combineGateAndExpertPredictions([gate], [expert]);
    expect(hybrid?.predicted).toBe('diagram');
    expect(hybrid?.acceptance_score).toBe(0.8);
    const [rejected] = combineGateAndExpertPredictions([
      {...gate, raw_predicted: null, predicted: null, abstained: true},
    ], [expert]);
    expect(rejected?.predicted).toBeNull();
  });
});
