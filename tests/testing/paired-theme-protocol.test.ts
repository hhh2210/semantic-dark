import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  loadPairedThemeProtocol,
  validateProtocol,
  validateSceneManifest,
} from '../../src/testing/paired-theme/protocol';
import type {SceneDefinition} from '../../src/testing/paired-theme/types';
import spectrumProtocol from '../../fixtures/paired-theme/spectrum-v1.protocol.json';

const limits = {maxScenes: 24, maxReviewedDecisions: 50};
const materialSource = {
  system: 'material', kind: 'generated-scheme',
  package: {
    name: '@material/material-color-utilities', version: '0.4.0',
    integrity: 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==',
    license: 'Apache-2.0',
    repository: 'https://github.com/material-foundation/material-color-utilities',
  },
  generator: {seed: '#6750A4', variant: 'tonal-spot', specVersion: '2021',
    platform: 'phone', contrastLevel: 0},
};
const primerSource = {
  system: 'primer', kind: 'static-token-json',
  package: {
    name: '@primer/primitives', version: '11.9.0',
    integrity: 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==',
    license: 'MIT', repository: 'https://github.com/primer/primitives',
  },
  lightPath: 'dist/docs/functional/themes/light.json',
  darkPath: 'dist/docs/functional/themes/dark.json',
};

function scene(overrides: Partial<SceneDefinition> = {}): SceneDefinition {
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
      source: materialSource,
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
        comparisonEpsilon: 1e-7,
        accentChromaThreshold: 0.02,
        textContrastFloor: 4.5,
        nonTextContrastFloor: 3,
        surfaceSeparationFloor: 1.12,
        componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
      },
    });
    expect(protocol.source.system).toBe('material');
  });

  it('rejects held-out access and oversized protocols in M1a', () => {
    const base = {
      schema: 'semantic-dark.paired-theme-protocol.v1',
      id: 'bad',
      source: materialSource,
      sceneManifest: 'scenes.json',
      viewport: {width: 1280, height: 900, deviceScaleFactor: 1},
      locale: 'en-US',
      colorProfile: 'srgb',
      metric: {
        status: 'development-draft',
        deltaEOkCap: 0.1,
        contrastLog2Cap: 1,
        rankTieEpsilon: 0.01,
        comparisonEpsilon: 1e-7,
        accentChromaThreshold: 0.02,
        textContrastFloor: 4.5,
        nonTextContrastFloor: 3,
        surfaceSeparationFloor: 1.12,
        componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
      },
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

  it('accepts the bounded Primer static-token contract and rejects source drift', () => {
    const protocol = validateProtocol({
      schema: 'semantic-dark.paired-theme-protocol.v1', id: 'primer-test',
      split: 'development', source: primerSource, sceneManifest: './scenes.json',
      viewport: {width: 1280, height: 900, deviceScaleFactor: 1}, locale: 'en-US',
      colorProfile: 'srgb', limits,
      metric: {
        status: 'development-draft', deltaEOkCap: 0.1, contrastLog2Cap: 1,
        rankTieEpsilon: 0.01, comparisonEpsilon: 1e-7, accentChromaThreshold: 0.02,
        textContrastFloor: 4.5, nonTextContrastFloor: 3, surfaceSeparationFloor: 1.12,
        componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
      },
    });
    expect(protocol.source.system).toBe('primer');
    expect(() => validateProtocol({...protocol, source: {...primerSource,
      lightPath: 'dist/docs/functional/themes/dark.json'}})).toThrow(/source paths/);
    expect(() => validateProtocol({...protocol, source: {...primerSource,
      package: {...primerSource.package, extra: 'drift'}}})).toThrow(/unexpected shape/);
  });

  it('accepts the exact Spectrum cascade contract and rejects ordered-path drift', () => {
    const protocol = validateProtocol(spectrumProtocol);
    expect(protocol.source.system).toBe('spectrum');
    if (protocol.source.system !== 'spectrum') throw new Error('Expected Spectrum source');
    const source = protocol.source;
    expect(() => validateProtocol({...protocol, source: {
      ...source,
      tokenPaths: [...source.tokenPaths].reverse(),
    }})).toThrow(/token paths/);
    expect(() => validateProtocol({...protocol, source: {
      ...source,
      schema: {...source.schema, specVersion: 'future'},
    }})).toThrow(/schema contract/);
  });

  it('resolves the scene manifest relative to the protocol and blocks path escape', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'paired-theme-protocol-'));
    try {
      const scenePath = path.join(directory, 'scenes.json');
      const protocolPath = path.join(directory, 'protocol.json');
      await writeFile(scenePath, JSON.stringify({
        schema: 'semantic-dark.paired-theme-scenes.v1', scenes: [scene()],
      }));
      const protocol = {
        schema: 'semantic-dark.paired-theme-protocol.v1', id: 'relative',
        split: 'development', source: materialSource, sceneManifest: './scenes.json',
        viewport: {width: 100, height: 100, deviceScaleFactor: 1}, locale: 'en-US',
        colorProfile: 'srgb', limits,
        metric: {status: 'development-draft', deltaEOkCap: 0.1, contrastLog2Cap: 1,
          rankTieEpsilon: 0.01, comparisonEpsilon: 1e-7, accentChromaThreshold: 0.02,
          textContrastFloor: 4.5, nonTextContrastFloor: 3, surfaceSeparationFloor: 1.12,
          componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3}},
      };
      await writeFile(protocolPath, JSON.stringify(protocol));
      expect((await loadPairedThemeProtocol(protocolPath)).sceneManifestPath).toBe(scenePath);
      await writeFile(protocolPath, JSON.stringify({...protocol, sceneManifest: '../escape.json'}));
      await expect(loadPairedThemeProtocol(protocolPath)).rejects.toThrow(/stay inside/);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
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

  it('rejects duplicate surface-pair identities within or across scenes', () => {
    const paired = scene({
      surfacePairs: [{id: 'surface-order', lowerPaintId: 'canvas', upperPaintId: 'text'}],
    });
    expect(() => validateSceneManifest({
      schema: 'semantic-dark.paired-theme-scenes.v1',
      scenes: [{
        ...paired,
        surfacePairs: [...paired.surfacePairs, {...paired.surfacePairs[0]}],
      }],
    }, limits)).toThrow('Duplicate surface pair id');

    const second = scene({
      id: 'scene-2',
      paints: paired.paints.map((paint) => ({
        ...paint,
        id: `${paint.id}-2`,
        backdropPaintId: paint.backdropPaintId === null ? null : `${paint.backdropPaintId}-2`,
      })),
      surfacePairs: [{
        id: 'surface-order',
        lowerPaintId: 'canvas-2',
        upperPaintId: 'text-2',
      }],
    });
    expect(() => validateSceneManifest({
      schema: 'semantic-dark.paired-theme-scenes.v1',
      scenes: [paired, second],
    }, limits)).toThrow('Duplicate surface pair id');
  });
});
