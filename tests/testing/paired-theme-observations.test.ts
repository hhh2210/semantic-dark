import {describe, expect, it} from 'vitest';

import {compositeSrgb, parseCssColor} from '../../src/color';
import {
  buildObservationMatrix,
  effectivePaintMap,
  REQUIRED_OBSERVATION_VARIANTS,
} from '../../src/testing/paired-theme/observations';
import type {
  ObservationVariant,
  PaintObservation,
  SceneDefinition,
} from '../../src/testing/paired-theme/types';

const scene: SceneDefinition = {
  id: 'alpha', kind: 'surface-stack', title: 'Alpha',
  paints: [
    {id: 'canvas', component: 'page', state: 'default', property: 'background-color', pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null, contrastKind: 'none', reviewed: false},
    {id: 'surface', component: 'card', state: 'default', property: 'background-color', pseudo: null, role: 'surface', token: 'surface', backdropPaintId: 'canvas', contrastKind: 'none', reviewed: true},
    {id: 'text', component: 'copy', state: 'default', property: 'color', pseudo: null, role: 'text', token: 'textPrimary', backdropPaintId: 'surface', contrastKind: 'text', reviewed: true},
  ],
  surfacePairs: [{id: 'canvas-surface', lowerPaintId: 'canvas', upperPaintId: 'surface'}],
};

const VALUES: Record<ObservationVariant, Record<string, string>> = {
  light: {canvas: '#fff', surface: 'rgb(255 0 0 / 50%)', text: '#000'},
  'authored-dark': {canvas: '#000', surface: 'rgb(0 0 255 / 50%)', text: '#fff'},
  'baseline-candidate': {canvas: '#111', surface: 'rgb(0 255 0 / 50%)', text: '#fff'},
};

function observations(): PaintObservation[] {
  return REQUIRED_OBSERVATION_VARIANTS.flatMap((variant) => scene.paints.map((paint) => ({
    schema: 'semantic-dark.paint-observation.v1',
    system: 'material', split: 'development', variant, sceneId: scene.id,
    paintId: paint.id, component: paint.component, state: paint.state,
    property: paint.property, pseudo: paint.pseudo, role: paint.role,
    backdropPaintId: paint.backdropPaintId, contrastKind: paint.contrastKind,
    reviewed: paint.reviewed, value: VALUES[variant][paint.id]!, opacity: '1',
    display: 'block', visibility: 'visible', rect: {x: 0, y: 0, width: 40, height: 20},
  })));
}

describe('paired-theme observation matrix', () => {
  it('requires all three variants and composites CSS alpha through the backdrop DAG', () => {
    const matrix = buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene], observations: observations(),
    });
    const light = effectivePaintMap(matrix, 'light');
    expect(light.get('surface')!.effectiveColor).toEqual(compositeSrgb(
      parseCssColor(VALUES.light.surface!)!,
      parseCssColor(VALUES.light.canvas!)!,
    ));
    expect(light.get('text')!.backdropEffectiveColor).toEqual(light.get('surface')!.effectiveColor);
  });

  it('hard-fails missing, duplicate, and static-metadata mismatches', () => {
    const complete = observations();
    expect(() => buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene],
      observations: complete.slice(1),
    })).toThrow(/Expected 9 observations/);
    expect(() => buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene],
      observations: [...complete.slice(0, -1), complete[0]!],
    })).toThrow(/Duplicate observation/);
    expect(() => buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene],
      observations: complete.map((row, index) => index === 0 ? {...row, role: 'text'} : row),
    })).toThrow(/role mismatch/);
  });

  it('rejects non-unit CSS opacity and translucent roots', () => {
    const withOpacity = observations();
    withOpacity[0] = {...withOpacity[0]!, opacity: '0.5'};
    expect(() => buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene], observations: withOpacity,
    })).toThrow(/group opacity/);

    const translucentRoot = observations().map((row) => row.paintId === 'canvas'
      ? {...row, value: 'rgb(255 255 255 / 50%)'} : row);
    expect(() => buildObservationMatrix({
      system: 'material', split: 'development', scenes: [scene], observations: translucentRoot,
    })).toThrow(/not opaque/);
  });
});
