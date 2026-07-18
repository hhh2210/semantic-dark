import {describe, expect, it} from 'vitest';

import {contrastRatio, parseCssColor, srgbToOklab} from '../../src/color';
import {evaluatePairedThemeSystem} from '../../src/testing/paired-theme/evaluate';
import {
  buildObservationMatrix,
  effectivePaintMap,
  REQUIRED_OBSERVATION_VARIANTS,
} from '../../src/testing/paired-theme/observations';
import type {
  ObservationVariant,
  PaintObservation,
  PairedThemeMetricConfig,
  SceneDefinition,
} from '../../src/testing/paired-theme/types';

const METRIC: PairedThemeMetricConfig = {
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
};

const SCENES: SceneDefinition[] = [
  {
    id: 'surface', kind: 'surface-stack', title: 'Surface hierarchy',
    paints: [
      paint('canvas', 'page', 'background-color', 'background', 'canvas', null, 'none', false),
      paint('surface', 'card', 'background-color', 'surface', 'surface', 'canvas', 'none'),
      paint('raised', 'dialog', 'background-color', 'surface', 'surfaceRaised', 'surface', 'none'),
      paint('body-text', 'copy', 'color', 'text', 'textPrimary', 'surface', 'text'),
    ],
    surfacePairs: [
      {id: 'canvas-surface', lowerPaintId: 'canvas', upperPaintId: 'surface'},
      {id: 'surface-raised', lowerPaintId: 'surface', upperPaintId: 'raised'},
    ],
  },
  {
    id: 'accent', kind: 'form-focus', title: 'Accent eligibility',
    paints: [
      paint('panel', 'form', 'background-color', 'surface', 'surface', null, 'none', false),
      paint('focus-vivid', 'input', 'outline-color', 'accent', 'focus', 'panel', 'non-text'),
      paint('focus-muted', 'button', 'border-color', 'accent', 'border', 'panel', 'none'),
    ],
    surfacePairs: [],
  },
];

const VALUES: Record<ObservationVariant, Record<string, string>> = {
  light: {
    canvas: '#ffffff', surface: '#eeeeee', raised: '#dddddd', 'body-text': '#000000',
    panel: '#ffffff', 'focus-vivid': '#0066ff', 'focus-muted': '#777777',
  },
  'authored-dark': {
    canvas: '#111111', surface: '#444444', raised: '#777777', 'body-text': '#ffffff',
    panel: '#000000', 'focus-vivid': '#ff0000', 'focus-muted': '#777777',
  },
  'baseline-candidate': {
    canvas: '#555555', surface: '#222222', raised: '#292929', 'body-text': '#333333',
    panel: '#666666', 'focus-vivid': '#666666', 'focus-muted': '#787878',
  },
};

describe('paired-theme evaluator golden contract', () => {
  it('calculates exact D/C/R rows, denominators, and the baseline-only composite', () => {
    const matrix = observationMatrix(SCENES, observations(SCENES));
    const result = evaluatePairedThemeSystem(matrix, SCENES, METRIC);
    const authored = effectivePaintMap(matrix, 'authored-dark');
    const candidate = effectivePaintMap(matrix, 'baseline-candidate');

    expect(result.counts).toEqual({
      scenes: 2,
      paintsPerVariant: 7,
      observations: 21,
      reviewedDecisions: 5,
      colorRows: 5,
      contrastRows: 2,
      rankPairs: 2,
      colorByRole: {accent: 2, surface: 2, text: 1},
      contrastByRole: {accent: 1, text: 1},
    });

    for (const row of result.rows.color) {
      const expectedDelta = deltaOk(
        candidate.get(row.decisionId)!.effectiveColor,
        authored.get(row.decisionId)!.effectiveColor,
      );
      expect(row.deltaOk).toBeCloseTo(expectedDelta, 12);
      expect(row.cap).toBe(0.1);
      expect(row.loss).toBeCloseTo(Math.min(expectedDelta / 0.1, 1), 12);
    }
    expect(result.rows.color.find((row) => row.decisionId === 'focus-muted')!.loss)
      .toBeLessThan(1);

    for (const row of result.rows.contrast) {
      const candidatePaint = candidate.get(row.decisionId)!;
      const authoredPaint = authored.get(row.decisionId)!;
      const expectedCandidate = contrastRatio(
        candidatePaint.effectiveColor,
        candidatePaint.backdropEffectiveColor!,
      );
      const expectedAuthored = contrastRatio(
        authoredPaint.effectiveColor,
        authoredPaint.backdropEffectiveColor!,
      );
      const expectedRaw = Math.abs(Math.log2(expectedCandidate / expectedAuthored));
      expect(row.candidateRatio).toBeCloseTo(expectedCandidate, 12);
      expect(row.authoredRatio).toBeCloseTo(expectedAuthored, 12);
      expect(row.absoluteLog2Error).toBeCloseTo(expectedRaw, 12);
      expect(row.loss).toBeCloseTo(Math.min(expectedRaw, 1), 12);
    }

    expect(result.rows.rank).toMatchObject([
      {pairId: 'canvas-surface', candidateRelation: -1, authoredRelation: 1, loss: 1,
        separationPass: true, inversion: true, tieMismatch: false},
      {pairId: 'surface-raised', candidateRelation: 1, authoredRelation: 1, loss: 0,
        separationPass: false, inversion: false, tieMismatch: false},
    ]);
    for (const row of result.rows.rank) {
      expect(row.candidateDeltaL).toBeCloseTo(
        lightness(candidate.get(row.upperPaintId)!.effectiveColor) -
          lightness(candidate.get(row.lowerPaintId)!.effectiveColor),
        12,
      );
      expect(row.authoredDeltaL).toBeCloseTo(
        lightness(authored.get(row.upperPaintId)!.effectiveColor) -
          lightness(authored.get(row.lowerPaintId)!.effectiveColor),
        12,
      );
    }

    const expectedD = mean(['accent', 'surface', 'text'].map((role) =>
      median(result.rows.color.filter((row) => row.role === role).map((row) => row.loss))));
    const expectedC = mean(['accent', 'text'].map((role) =>
      median(result.rows.contrast.filter((row) => row.role === role).map((row) => row.loss))));
    const expectedR = mean(result.rows.rank.map((row) => row.loss));
    const expectedE = (expectedD + expectedC + expectedR) / 3;
    expect(result.primary).toMatchObject({d: expectedD, c: expectedC, r: expectedR});
    expect(result.primary.e).toBeCloseTo(expectedE, 12);
    expect(result.primary.pairScore).toBeCloseTo(100 * (1 - expectedE), 12);
    expect(result.primary.relativeErrorReduction).toEqual({
      formula: '(E_baseline-E_candidate)/E_baseline',
      baselineE: result.primary.e,
      candidateE: null,
      value: null,
      status: 'not-applicable-baseline-only',
    });
  });

  it('keeps raw contrast uncapped and emits every automatic hard finding', () => {
    const result = evaluatePairedThemeSystem(
      observationMatrix(SCENES, observations(SCENES)), SCENES, METRIC,
    );
    const rawErrors = result.rows.contrast.map((row) => row.absoluteLog2Error);

    expect(rawErrors.every((error) => error > 1)).toBe(true);
    expect(result.rows.contrast.every((row) => row.loss === 1)).toBe(true);
    expect(result.secondary.contrastErrorRaw).toBeCloseTo(mean(rawErrors), 12);
    expect(result.secondary.contrastErrorRaw).toBeGreaterThan(1);
    expect(result.findings.map((finding) => finding.rule)).toEqual([
      'non-text-contrast',
      'text-contrast',
      'surface-rank-reversal',
      'surface-separation',
    ]);
    expect(result.secondary).toMatchObject({
      hardFailureCount: 4,
      textContrastFailures: 1,
      nonTextContrastFailures: 1,
      surfaceSeparationFailures: 1,
      surfaceRankReversals: 1,
      surfaceRankInversionRate: 0.5,
      accentHueErrorDegrees: 180,
      accentHueEligible: 1,
      accentHueLowChromaCandidates: 1,
    });
  });

  it('is invariant to scene, paint, pair, and observation input order', () => {
    const canonical = evaluatePairedThemeSystem(
      observationMatrix(SCENES, observations(SCENES)), SCENES, METRIC,
    );
    const reordered = [...SCENES].reverse().map((scene) => ({
      ...scene,
      paints: [...scene.paints].reverse(),
      surfacePairs: [...scene.surfacePairs].reverse(),
    }));
    const reorderedResult = evaluatePairedThemeSystem(
      observationMatrix(reordered, observations(reordered).reverse()), reordered, METRIC,
    );

    expect(reorderedResult).toEqual(canonical);
  });
});

function paint(
  id: string,
  component: string,
  property: SceneDefinition['paints'][number]['property'],
  role: SceneDefinition['paints'][number]['role'],
  token: SceneDefinition['paints'][number]['token'],
  backdropPaintId: string | null,
  contrastKind: SceneDefinition['paints'][number]['contrastKind'],
  reviewed = true,
): SceneDefinition['paints'][number] {
  return {id, component, state: 'default', property, pseudo: null, role, token,
    backdropPaintId, contrastKind, reviewed};
}

function observations(scenes: readonly SceneDefinition[]): PaintObservation[] {
  return REQUIRED_OBSERVATION_VARIANTS.flatMap((variant) => scenes.flatMap((scene) =>
    scene.paints.map((definition) => ({
      schema: 'semantic-dark.paint-observation.v1',
      system: 'material', split: 'development', variant, sceneId: scene.id,
      paintId: definition.id, component: definition.component, state: definition.state,
      property: definition.property, pseudo: definition.pseudo, role: definition.role,
      backdropPaintId: definition.backdropPaintId, contrastKind: definition.contrastKind,
      reviewed: definition.reviewed, value: VALUES[variant][definition.id]!, opacity: '1',
      display: 'block', visibility: 'visible', rect: {x: 0, y: 0, width: 40, height: 20},
    }))),
  );
}

function observationMatrix(scenes: readonly SceneDefinition[], rows: readonly PaintObservation[]) {
  return buildObservationMatrix({system: 'material', split: 'development', scenes,
    observations: rows});
}

function deltaOk(left: NonNullable<ReturnType<typeof parseCssColor>>,
  right: NonNullable<ReturnType<typeof parseCssColor>>): number {
  const a = srgbToOklab(left);
  const b = srgbToOklab(right);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

function lightness(color: NonNullable<ReturnType<typeof parseCssColor>>): number {
  return srgbToOklab(color).l;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[midpoint]! :
    (ordered[midpoint - 1]! + ordered[midpoint]!) / 2;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
