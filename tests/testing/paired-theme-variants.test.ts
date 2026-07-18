import {describe, expect, it} from 'vitest';

import {buildThemeVariantValues} from '../../src/testing/paired-theme/variants';
import type {NormalizedThemePair, SceneDefinition} from '../../src/testing/paired-theme/types';

const scenes: SceneDefinition[] = [{
  id: 'scene', kind: 'surface-stack', title: 'Scene',
  paints: [
    {id: 'canvas', component: 'page', state: 'default', property: 'background-color', pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null, contrastKind: 'none', reviewed: true},
    {id: 'text', component: 'copy', state: 'default', property: 'color', pseudo: null, role: 'text', token: 'textPrimary', backdropPaintId: 'canvas', contrastKind: 'text', reviewed: true},
  ],
  surfacePairs: [],
}];

function theme(darkText: string): NormalizedThemePair {
  const token = (name: string, light: string, dark: string) => ({
    name, light, dark, sourceToken: name, provenance: 'authored-token' as const,
  });
  const tokens = {
    canvas: token('canvas', '#fff', '#111'),
    surface: token('surface', '#eee', '#222'),
    surfaceRaised: token('surfaceRaised', '#ddd', '#333'),
    textPrimary: token('textPrimary', '#111', darkText),
    textSecondary: token('textSecondary', '#444', '#bbb'),
    tableHeader: token('tableHeader', '#eee', '#222'),
    selectedSurface: token('selectedSurface', '#ddf', '#335'),
    border: token('border', '#777', '#999'),
    focus: token('focus', '#05f', '#8af'),
    dangerSurface: token('dangerSurface', '#fee', '#511'),
    dangerText: token('dangerText', '#900', '#faa'),
  } as unknown as NormalizedThemePair['tokens'];
  return {system: 'primer', split: 'development', source: {
    name: 'synthetic', version: '1', integrity: 'test', license: 'MIT', repository: 'test',
  }, tokens};
}

describe('paired-theme variant values', () => {
  it('keeps authored dark values out of baseline candidate generation', () => {
    const first = buildThemeVariantValues(theme('#fff'), scenes);
    const second = buildThemeVariantValues(theme('#f00'), scenes);
    expect(first.values['authored-dark'].text).not.toBe(second.values['authored-dark'].text);
    expect(first.values['baseline-candidate']).toEqual(second.values['baseline-candidate']);
    expect(first.values.light).toEqual(second.values.light);
  });

  it('emits exact, sorted paint identity sets for all variants', () => {
    const result = buildThemeVariantValues(theme('#fff'), scenes);
    for (const values of Object.values(result.values)) {
      expect(Object.keys(values)).toEqual(['canvas', 'text']);
    }
    expect(result.candidateMappings.map((mapping) => mapping.paintId)).toEqual(['canvas', 'text']);
  });
});
