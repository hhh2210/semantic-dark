import {describe, expect, it} from 'vitest';
import {validateProtocol, validateSceneManifest} from '../../src/testing/paired-theme/protocol';

const limits = {maxScenes: 24, maxReviewedDecisions: 50};

function scene(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scene',
    kind: 'surface-stack',
    title: 'Scene',
    paints: [
      {id: 'canvas', component: 'page', state: 'default', property: 'background-color', pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null, contrastKind: 'none', reviewed: true},
      {id: 'text', component: 'copy', state: 'default', property: 'color', pseudo: null, role: 'text', token: 'textPrimary', backdropPaintId: 'canvas', contrastKind: 'text', reviewed: true},
    ],
    surfacePairs: [],
    ...overrides,
  };
}

describe('paired-theme protocol validation', () => {
  it('accepts the bounded Material development contract', () => {
    const protocol = validateProtocol({
      schema: 'semantic-dark.paired-theme-protocol.v1',
      id: 'material-test',
      split: 'development',
      source: {system: 'material', kind: 'generated-scheme'},
      sceneManifest: 'fixtures/paired-theme/common-scenes.v1.json',
      viewport: {width: 1280, height: 900, deviceScaleFactor: 1},
      locale: 'en-US',
      colorProfile: 'srgb',
      limits,
      metric: {
        status: 'development-draft',
        deltaEOkCap: 0.1,
        contrastLog2Cap: 1,
        rankTieEpsilon: 0.01,
        componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
      },
    });
    expect(protocol.source.system).toBe('material');
  });

  it('rejects held-out access and oversized protocols in M1a', () => {
    const base = {
      schema: 'semantic-dark.paired-theme-protocol.v1',
      id: 'bad',
      source: {system: 'material', kind: 'generated-scheme'},
      sceneManifest: 'scenes.json',
      viewport: {width: 1280, height: 900, deviceScaleFactor: 1},
      locale: 'en-US',
      colorProfile: 'srgb',
      metric: {componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3}},
    };
    expect(() => validateProtocol({...base, split: 'held-out', limits})).toThrow(
      'development protocols only',
    );
    expect(() => validateProtocol({
      ...base,
      split: 'development',
      limits: {maxScenes: 25, maxReviewedDecisions: 50},
    })).toThrow('exceeds the M1');
  });

  it('rejects backdrop cycles, duplicates, and reviewed-row overflow', () => {
    const cyclic = scene({paints: [
      {id: 'a', component: 'a', state: 'default', property: 'background-color', pseudo: null, role: 'surface', token: 'surface', backdropPaintId: 'b', contrastKind: 'none', reviewed: true},
      {id: 'b', component: 'b', state: 'default', property: 'background-color', pseudo: null, role: 'surface', token: 'surfaceRaised', backdropPaintId: 'a', contrastKind: 'none', reviewed: true},
    ]});
    expect(() => validateSceneManifest({
      schema: 'semantic-dark.paired-theme-scenes.v1', scenes: [cyclic],
    }, limits)).toThrow('Backdrop cycle');
    expect(() => validateSceneManifest({
      schema: 'semantic-dark.paired-theme-scenes.v1', scenes: [scene(), scene()],
    }, limits)).toThrow('Duplicate scene id');
    expect(() => validateSceneManifest({
      schema: 'semantic-dark.paired-theme-scenes.v1', scenes: [scene()],
    }, {maxScenes: 24, maxReviewedDecisions: 1})).toThrow('Reviewed decision count');
  });
});
