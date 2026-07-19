import {describe, expect, it} from 'vitest';
import baselineProfile from '../../fixtures/profiles/baseline-profile.v2.json';
import {validateRoleProfiles} from '../../src/color/role-profiles';
import {mapCandidateTheme} from '../../src/testing/paired-theme/candidate';
import {parseHeldOutThemePair} from '../../src/testing/paired-theme/heldout-source';
import {CARBON_TOKEN_SELECTORS, FLUENT_TOKEN_SELECTORS} from '../../src/testing/paired-theme/protocol-source';
import {validateSceneManifest} from '../../src/testing/paired-theme/protocol';
import type {CarbonProtocolSource, FluentProtocolSource, NormalizedTokenName} from '../../src/testing/paired-theme/types';
import scenesJson from '../../fixtures/paired-theme/common-scenes.v1.json';

const BASELINE_PROFILES = validateRoleProfiles(baselineProfile.profiles);

const packagePin = (name: string, version: string, integrity: string, license: string,
  repository: string) => ({name, version, integrity, license, repository});

const carbon: CarbonProtocolSource = {
  system: 'carbon', kind: 'exported-theme-object',
  package: packagePin('@carbon/themes', '11.77.0',
    'sha512-5MGfcWiKwpIAmmtq4zlAeSkGkECaVXhr61Ol0EUFQskUlhAgeKhlIc5iWXFmwDb25oxzEFo0puH+GKsLL4GN/w==',
    'Apache-2.0', 'https://github.com/carbon-design-system/carbon'),
  lightExport: 'white', darkExport: 'g100', tokens: CARBON_TOKEN_SELECTORS,
};

const fluent: FluentProtocolSource = {
  system: 'fluent', kind: 'exported-theme-object',
  package: packagePin('@fluentui/react-theme', '9.2.1',
    'sha512-lJxfz7LmmglFz+c9C41qmMqaRRZZUPtPPl9DWQ79vH+JwZd4dkN7eA78OTRwcGCOTPEKoLTX72R+EFaWEDlX+w==',
    'MIT', 'https://github.com/microsoft/fluentui'),
  lightExport: 'webLightTheme', darkExport: 'webDarkTheme', tokens: FLUENT_TOKEN_SELECTORS,
};

describe('preregistered held-out source adapter', () => {
  it.each([carbon, fluent] as const)('normalizes $system only through frozen selector names', (source) => {
    const exports = themeExports(source, '#ffffff', '#111111');
    const pair = parseHeldOutThemePair(source, exports);
    expect(pair).toMatchObject({system: source.system, split: 'held-out', source: source.package});
    for (const name of Object.keys(source.tokens) as NormalizedTokenName[]) {
      expect(pair.tokens[name]).toMatchObject({
        sourceToken: source.tokens[name], light: '#ffffff', dark: '#111111',
        provenance: 'authored-token',
      });
    }
  });

  it('keeps candidate output independent of every authored-dark value', () => {
    const scenes = validateSceneManifest(scenesJson, {maxScenes: 24, maxReviewedDecisions: 50}).scenes;
    const first = parseHeldOutThemePair(carbon, themeExports(carbon, '#f8f8f8', '#111111'));
    const poisoned = parseHeldOutThemePair(carbon, themeExports(carbon, '#f8f8f8', '#ff00ff'));
    const light = (pair: typeof first) => Object.fromEntries(
      Object.entries(pair.tokens).map(([name, token]) => [name, token.light]),
    );
    expect(mapCandidateTheme(light(poisoned), scenes, BASELINE_PROFILES)).toEqual(
      mapCandidateTheme(light(first), scenes, BASELINE_PROFILES),
    );
  });

  it('fails closed on missing selectors, invalid colors, or contract drift', () => {
    const missing = themeExports(fluent, '#fff', '#111');
    delete (missing.webLightTheme as Record<string, string>).colorStrokeFocus2;
    expect(() => parseHeldOutThemePair(fluent, missing)).toThrow(/colorStrokeFocus2/);
    expect(() => parseHeldOutThemePair(fluent, themeExports(fluent, '12px', '#111')))
      .toThrow(/not a CSS color/);
    expect(() => parseHeldOutThemePair({...carbon, darkExport: 'g90'} as unknown as CarbonProtocolSource,
      themeExports(carbon, '#fff', '#111'))).toThrow(/theme exports/);
  });
});

function themeExports(
  source: CarbonProtocolSource | FluentProtocolSource,
  light: string,
  dark: string,
): Record<string, unknown> {
  const values = (color: string) => Object.fromEntries(
    Object.values(source.tokens).map((selector) => [selector, color]),
  );
  return {[source.lightExport]: values(light), [source.darkExport]: values(dark)};
}
