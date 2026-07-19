import {describe, expect, it} from 'vitest';
import {
  compositeSrgb,
  parseCssColor,
  quantizeSrgb8,
  rgba8ContrastRatios,
} from '../../src/color';
import baselineProfile from '../../fixtures/profiles/baseline-profile.v2.json';
import {mapRoleColorWithProfileSet} from '../../src/color/dark-map';
import {validateRoleProfiles, type RoleProfiles} from '../../src/color/role-profiles';
import {
  mapCandidateTheme,
  type LightTokenMap,
} from '../../src/testing/paired-theme/candidate';
import type {SceneDefinition} from '../../src/testing/paired-theme/types';

const TOKENS = {
  canvas: '#f8f8fa',
  surface: 'rgb(235 237 242 / 80%)',
  surfaceRaised: '#dfe3eb',
  textPrimary: 'rgb(23 24 27 / 37%)',
  border: '#707783',
} satisfies LightTokenMap;

const PROFILES = validateRoleProfiles(baselineProfile.profiles);

function surfaceScene(): SceneDefinition {
  return {
    id: 'surface-stack',
    kind: 'surface-stack',
    title: 'Surface stack',
    paints: [
      {
        id: 'canvas', component: 'page', state: 'default', property: 'background-color',
        pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null,
        contrastKind: 'none', reviewed: true,
      },
      {
        id: 'surface', component: 'card', state: 'default', property: 'background-color',
        pseudo: null, role: 'surface', token: 'surface', backdropPaintId: 'canvas',
        contrastKind: 'none', reviewed: true,
      },
      {
        id: 'raised', component: 'card', state: 'raised', property: 'background-color',
        pseudo: null, role: 'surface', token: 'surfaceRaised', backdropPaintId: 'surface',
        contrastKind: 'none', reviewed: true,
      },
      {
        id: 'text', component: 'copy', state: 'default', property: 'color', pseudo: null,
        role: 'text', token: 'textPrimary', backdropPaintId: 'raised',
        contrastKind: 'text', reviewed: true,
      },
    ],
    surfacePairs: [
      {id: 'surface-to-raised', lowerPaintId: 'surface', upperPaintId: 'raised'},
    ],
  };
}

function focusScene(): SceneDefinition {
  return {
    id: 'form-focus',
    kind: 'form-focus',
    title: 'Form focus',
    paints: [
      {
        id: 'form.canvas', component: 'form', state: 'default', property: 'background-color',
        pseudo: null, role: 'background', token: 'canvas', backdropPaintId: null,
        contrastKind: 'none', reviewed: true,
      },
      {
        id: 'form.border', component: 'input', state: 'default', property: 'border-color',
        pseudo: null, role: 'border', token: 'border', backdropPaintId: 'form.canvas',
        contrastKind: 'non-text', reviewed: true,
      },
    ],
    surfacePairs: [],
  };
}

describe('paired-theme candidate mapping', () => {
  it('maps a backdrop DAG and solves text against the mapped effective backdrop', () => {
    const mapped = mapCandidateTheme(TOKENS, [surfaceScene()], PROFILES);
    const byId = new Map(mapped.map((paint) => [paint.paintId, paint]));
    const canvas = byId.get('canvas')!;
    const surface = byId.get('surface')!;
    const raised = byId.get('raised')!;
    const text = byId.get('text')!;

    expect(surface.effectiveColor).toEqual(quantizeSrgb8(compositeSrgb(
      quantizeSrgb8(surface.mappedColor),
      canvas.effectiveColor,
    )));
    expect(raised.effectiveColor).toEqual(quantizeSrgb8(compositeSrgb(
      quantizeSrgb8(raised.mappedColor),
      surface.effectiveColor,
    )));

    const sourceText = parseCssColor(TOKENS.textPrimary!)!;
    const solvedText = mapRoleColorWithProfileSet(sourceText, {
      role: 'text',
      against: raised.effectiveColor,
    }, PROFILES);
    expect(text.mappedColor).toEqual(solvedText.color);
    expect(text.contrast.achieved).toBeCloseTo(
      rgba8ContrastRatios(text.mappedColor, raised.effectiveColor).minimum,
      12,
    );
    expect(text.contrast.achieved).toBeGreaterThanOrEqual(text.contrast.minimum);
  });

  it('preserves alpha when possible and exposes production contrast-driven alpha changes', () => {
    const mapped = mapCandidateTheme(TOKENS, [surfaceScene()], PROFILES);
    const surface = mapped.find((paint) => paint.paintId === 'surface')!;
    const text = mapped.find((paint) => paint.paintId === 'text')!;
    const sourceText = parseCssColor(TOKENS.textPrimary!)!;
    const raised = mapped.find((paint) => paint.paintId === 'raised')!;
    const solvedText = mapRoleColorWithProfileSet(sourceText, {
      role: 'text',
      against: raised.effectiveColor,
    }, PROFILES);

    expect(surface.mappedColor.a).toBeCloseTo(0.8, 12);
    expect(parseCssColor(surface.mappedCss)!.a).toBeCloseTo(0.8, 6);
    expect(text.mappedColor).toEqual(solvedText.color);
    expect(text.mappedColor.a).toBeGreaterThan(sourceText.a);
    expect(parseCssColor(text.mappedCss)!.a).toBeCloseTo(solvedText.color.a, 6);
  });

  it('is invariant to scene and paint input order and emits canonical ordering', () => {
    const surfaces = surfaceScene();
    const focus = focusScene();
    const reversedSurfaces = {...surfaces, paints: [...surfaces.paints].reverse()};
    const reversedFocus = {...focus, paints: [...focus.paints].reverse()};

    const forward = mapCandidateTheme(TOKENS, [surfaces, focus], PROFILES);
    const reversed = mapCandidateTheme(TOKENS, [reversedFocus, reversedSurfaces], PROFILES);

    expect(reversed).toEqual(forward);
    expect(forward.map(({sceneId, paintId}) => `${sceneId}/${paintId}`)).toEqual([
      'form-focus/form.border',
      'form-focus/form.canvas',
      'surface-stack/canvas',
      'surface-stack/raised',
      'surface-stack/surface',
      'surface-stack/text',
    ]);
  });

  it('hard-fails cycles and unknown backdrops', () => {
    const cycle = surfaceScene();
    cycle.paints[0] = {...cycle.paints[0]!, backdropPaintId: 'text'};
    expect(() => mapCandidateTheme(TOKENS, [cycle], PROFILES)).toThrow('Backdrop cycle');

    const missing = surfaceScene();
    missing.paints[1] = {...missing.paints[1]!, backdropPaintId: 'absent'};
    expect(() => mapCandidateTheme(TOKENS, [missing], PROFILES)).toThrow(
      'Unknown backdrop absent for surface',
    );
  });

  it('hard-fails duplicate ids, missing tokens, and invalid light colors', () => {
    const duplicateScene = surfaceScene();
    expect(() => mapCandidateTheme(TOKENS, [duplicateScene, duplicateScene], PROFILES)).toThrow(
      'Duplicate scene id',
    );

    const duplicatePaint = surfaceScene();
    duplicatePaint.paints[1] = {...duplicatePaint.paints[1]!, id: 'canvas'};
    expect(() => mapCandidateTheme(TOKENS, [duplicatePaint], PROFILES)).toThrow('Duplicate paint id');

    const {textPrimary: _missing, ...missingText} = TOKENS;
    expect(() => mapCandidateTheme(missingText, [surfaceScene()], PROFILES)).toThrow(
      'Missing light token textPrimary for paint text',
    );
    expect(() => mapCandidateTheme(
      {...TOKENS, textPrimary: 'var(--not-resolved)'}, [surfaceScene()], PROFILES,
    ))
      .toThrow('Invalid light token textPrimary');
  });

  it('uses the explicit complete profile set without an authored-dark input', () => {
    const tuned = structuredClone(PROFILES) as Record<string, Record<string, number>>;
    tuned.background!.minimumLightness = 0.18;
    tuned.background!.lightnessSpan = 0.04;
    const mapped = mapCandidateTheme(TOKENS, [surfaceScene()], tuned as RoleProfiles);
    const baseline = mapCandidateTheme(TOKENS, [surfaceScene()], PROFILES);
    expect(mapped.find((paint) => paint.paintId === 'canvas')!.mappedColor)
      .not.toEqual(baseline.find((paint) => paint.paintId === 'canvas')!.mappedColor);

    const incomplete = structuredClone(PROFILES) as Record<string, unknown>;
    delete incomplete.svgStroke;
    expect(() => mapCandidateTheme(TOKENS, [surfaceScene()], incomplete as RoleProfiles))
      .toThrow(/exactly/);
    expect(() => mapCandidateTheme(
      TOKENS,
      [surfaceScene()],
      undefined as unknown as RoleProfiles,
    )).toThrow(/must be an object/);
  });
});
