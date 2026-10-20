import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

import {validateRoleProfiles, type RoleProfiles} from '../../src/color/role-profiles';
import {loadBaselineRoleProfile} from '../../src/testing/paired-theme/profile-fixture';
import type {NormalizedThemePair, SceneManifest} from '../../src/testing/paired-theme/types';
import {buildV2ThemeVariantValues} from '../../src/testing/paired-theme/v2/variants';

const SCENES = (JSON.parse(readFileSync(path.join(
  process.cwd(), 'fixtures/paired-theme/common-scenes.v1.json',
), 'utf8')) as SceneManifest).scenes;
const ROLES = {
  light: 'light', authoredDark: 'authored-dark',
  baselineCandidate: 'baseline-candidate', m2Candidate: 'm2-candidate',
} as const;

function theme(): NormalizedThemePair {
  const values = {
    canvas: ['#ffffff', '#101010'], surface: ['#f5f5f5', '#202020'],
    surfaceRaised: ['#eeeeee', '#303030'], textPrimary: ['#111111', '#f5f5f5'],
    textSecondary: ['#555555', '#cccccc'], tableHeader: ['#e5e5e5', '#242424'],
    selectedSurface: ['#dce8ff', '#304a70'], border: ['#888888', '#aaaaaa'],
    focus: ['#1769ff', '#80b0ff'], dangerSurface: ['#fff0f0', '#401818'],
    dangerText: ['#8a1010', '#ffdddd'],
  } as const;
  return {
    system: 'material', split: 'development',
    source: {name: 'synthetic', version: '1.0.0', integrity: 'sha512-test', license: 'MIT',
      repository: 'https://example.test'},
    tokens: Object.fromEntries(Object.entries(values).map(([name, [light, dark]]) => [name, {
      name, light, dark, sourceToken: name, provenance: 'authored-token',
      resolutionPath: {light: [name, 'light'], dark: [name, 'dark']},
    }])) as unknown as NormalizedThemePair['tokens'],
  };
}

describe('v2 four-condition variant builder', () => {
  it('builds both profile arms and keeps authored values outside the mapper', async () => {
    const baseline = (await loadBaselineRoleProfile(process.cwd())).profiles;
    const tuned = validateRoleProfiles({
      ...baseline,
      background: {...baseline.background, minimumLightness: 0.2, lightnessSpan: 0.02},
    }) as RoleProfiles;
    const input = theme();
    const result = buildV2ThemeVariantValues(input, SCENES, baseline, tuned, ROLES);

    expect(Object.keys(result.values)).toEqual([
      'light', 'authored-dark', 'baseline-candidate', 'm2-candidate',
    ]);
    expect(Object.values(result.values).every((rows) => Object.keys(rows).length === 15)).toBe(true);
    expect(result.values[ROLES.light]!['surface.canvas']).toBe('#ffffff');
    expect(result.values[ROLES.authoredDark]!['surface.canvas']).toBe('#101010');
    expect(result.values[ROLES.baselineCandidate]!['surface.canvas'])
      .not.toBe(result.values[ROLES.m2Candidate]!['surface.canvas']);

    const original = theme();
    const poisoned: NormalizedThemePair = {
      ...original,
      tokens: {...original.tokens, canvas: {...original.tokens.canvas, dark: '#ff00ff'}},
    };
    const poisonedResult = buildV2ThemeVariantValues(poisoned, SCENES, baseline, tuned, ROLES);
    expect(poisonedResult.values[ROLES.authoredDark]!['surface.canvas']).toBe('#ff00ff');
    expect(poisonedResult.values[ROLES.baselineCandidate])
      .toEqual(result.values[ROLES.baselineCandidate]);
    expect(poisonedResult.values[ROLES.m2Candidate]).toEqual(result.values[ROLES.m2Candidate]);
  });

  it('rejects aliased semantic variants before rendering', async () => {
    const baseline = (await loadBaselineRoleProfile(process.cwd())).profiles;
    expect(() => buildV2ThemeVariantValues(theme(), SCENES, baseline, baseline, {
      ...ROLES, m2Candidate: 'baseline-candidate',
    })).toThrow(/four distinct/);
  });
});
