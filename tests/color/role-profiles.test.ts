import {readFile} from 'node:fs/promises';

import {describe, expect, it} from 'vitest';

import * as productionColorApi from '../../src/color';
import baselineArtifact from '../../fixtures/profiles/baseline-profile.v2.json';
import profileSchema from '../../fixtures/profiles/role-profile.schema.json';
import {
  mapRoleColorWithReport,
  srgb,
  type ColorRole,
  type RoleMapOptions,
} from '../../src/color';
import {mapRoleColorWithProfileSet} from '../../src/color/dark-map';
import {
  BASELINE_ROLE_PROFILES_SEMANTIC_SHA256,
  COLOR_ROLES,
  serializeRoleProfilesCanonical,
  validateRoleProfiles,
  type RoleProfiles,
} from '../../src/color/role-profiles';
import {sha256Text} from '../../src/testing/artifacts';
import {
  BASELINE_ROLE_PROFILE_FILE_SHA256,
  loadBaselineRoleProfile,
} from '../../src/testing/paired-theme/profile-fixture';

const BASELINE_FILE_SHA256 = '0b7e66c6bc2281e3387fe5a9df6d57a62fcecb5f7948d39e224f99850d105f5f';

describe('role-profile artifact identity', () => {
  it('preserves the M0 semantic hash separately from the artifact file hash', async () => {
    expect(baselineArtifact).toMatchObject({
      $schema: './role-profile.schema.json',
      schema: 'semantic-dark.role-profile.v2',
      id: 'semantic-dark.baseline-role-profile.v2',
      kind: 'baseline',
      semanticSha256: BASELINE_ROLE_PROFILES_SEMANTIC_SHA256,
    });
    expect(profileSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    });
    expect(sha256Text(serializeRoleProfilesCanonical(baselineArtifact.profiles))).toBe(
      'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5',
    );
    const bytes = await readFile('fixtures/profiles/baseline-profile.v2.json', 'utf8');
    expect(sha256Text(bytes)).toBe(BASELINE_FILE_SHA256);
    expect(BASELINE_FILE_SHA256).not.toBe(BASELINE_ROLE_PROFILES_SEMANTIC_SHA256);
  });

  it('loads an immutable, pinned baseline fixture in the frozen role order', async () => {
    expect(COLOR_ROLES).toEqual([
      'background', 'surface', 'text', 'border', 'accent', 'svgFill', 'svgStroke',
    ]);
    const loaded = await loadBaselineRoleProfile(process.cwd());
    expect(BASELINE_ROLE_PROFILE_FILE_SHA256).toBe(BASELINE_FILE_SHA256);
    expect(loaded).toMatchObject({
      path: 'fixtures/profiles/baseline-profile.v2.json',
      semanticSha256: BASELINE_ROLE_PROFILES_SEMANTIC_SHA256,
      fileSha256: BASELINE_FILE_SHA256,
    });
    expect(loaded.profiles).toEqual(validateRoleProfiles(baselineArtifact.profiles));
    expect(Object.isFrozen(loaded.profiles)).toBe(true);
    for (const role of COLOR_ROLES) expect(Object.isFrozen(loaded.profiles[role])).toBe(true);
  });
});

describe('role-profile validation and injection', () => {
  it('rejects incomplete, extra, non-finite, and out-of-band profiles', () => {
    const missing = structuredClone(baselineArtifact.profiles) as Record<string, unknown>;
    delete missing.text;
    expect(() => validateRoleProfiles(missing)).toThrow(/exactly/);

    const extra = structuredClone(baselineArtifact.profiles) as Record<string, unknown>;
    extra.outcomeSelectedRole = extra.text;
    expect(() => validateRoleProfiles(extra)).toThrow(/exactly/);

    const extraField = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    extraField.text.afterResults = 0.9;
    expect(() => validateRoleProfiles(extraField)).toThrow(/exactly/);

    const nonFinite = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    nonFinite.accent.chromaScale = Number.NaN;
    expect(() => validateRoleProfiles(nonFinite)).toThrow(/finite/);

    const infinite = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    infinite.text.lightnessSpan = Number.POSITIVE_INFINITY;
    expect(() => validateRoleProfiles(infinite)).toThrow(/finite/);

    const negative = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    negative.border.minimumLightness = -0.01;
    expect(() => validateRoleProfiles(negative)).toThrow(/\[0, 1\]/);

    const overflowingBand = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    overflowingBand.surface.minimumLightness = 0.9;
    overflowingBand.surface.lightnessSpan = 0.2;
    expect(() => validateRoleProfiles(overflowingBand)).toThrow(/lightness band/);

    const source = srgb(0.4, 0.5, 0.6);
    expect(() => mapRoleColorWithProfileSet(
      source, {role: 'background'}, undefined as unknown as RoleProfiles,
    )).toThrow(/must be an object/);
    expect(() => mapRoleColorWithProfileSet(
      source, {role: 'background'}, missing as RoleProfiles,
    )).toThrow(/exactly/);
    expect(() => mapRoleColorWithProfileSet(
      source, {role: 'background'}, extra as RoleProfiles,
    )).toThrow(/exactly/);
    expect(() => mapRoleColorWithProfileSet(
      source, {role: 'background'}, nonFinite as RoleProfiles,
    )).toThrow(/finite/);
  });

  it('keeps production bit-identical while profile injection stays outside its options', () => {
    type ProductionOptionsContainProfiles = 'profiles' extends keyof RoleMapOptions ? true : false;
    const productionOptionsContainProfiles: ProductionOptionsContainProfiles = false;
    expect(productionOptionsContainProfiles).toBe(false);
    expect('SHIPPED_ROLE_PROFILES' in productionColorApi).toBe(false);
    expect('mapRoleColorWithProfileSet' in productionColorApi).toBe(false);

    const profiles = validateRoleProfiles(baselineArtifact.profiles);
    const sources = [srgb(0.04, 0.25, 0.8), srgb(0.9, 0.5, 0.1, 0.6)];
    for (const role of COLOR_ROLES as readonly ColorRole[]) {
      for (const source of sources) {
        const options = {role, against: srgb(0.05, 0.06, 0.07)} as const;
        expect(mapRoleColorWithReport(source, options)).toEqual(
          mapRoleColorWithProfileSet(source, options, profiles),
        );
      }
    }

    const tuned = structuredClone(baselineArtifact.profiles);
    tuned.background.minimumLightness = 0.2;
    tuned.background.lightnessSpan = 0.02;
    const source = srgb(0.9, 0.9, 0.9);
    const injected = mapRoleColorWithProfileSet(source, {role: 'background'}, tuned);
    const ignoredRuntimeProperty = mapRoleColorWithReport(source, {
      role: 'background',
      profiles: tuned,
    } as RoleMapOptions);
    expect(ignoredRuntimeProperty).toEqual(mapRoleColorWithReport(source, {role: 'background'}));
    expect(ignoredRuntimeProperty).not.toEqual(injected);
  });

  it('canonicalizes property insertion order without accepting partial fallbacks', () => {
    const reversed = Object.fromEntries(
      [...Object.entries(baselineArtifact.profiles)].reverse().map(([role, profile]) => [
        role,
        Object.fromEntries(Object.entries(profile).reverse()),
      ]),
    );
    expect(serializeRoleProfilesCanonical(reversed)).toBe(
      serializeRoleProfilesCanonical(baselineArtifact.profiles),
    );
  });

  it('revalidates mutable caller objects instead of returning a stale cached snapshot', () => {
    const mutable = structuredClone(baselineArtifact.profiles) as Record<string, any>;
    expect(validateRoleProfiles(mutable)).toEqual(validateRoleProfiles(baselineArtifact.profiles));
    mutable.text.minimumLightness = Number.NaN;
    mutable.unregisteredRole = mutable.text;
    expect(() => validateRoleProfiles(mutable)).toThrow();
  });
});
