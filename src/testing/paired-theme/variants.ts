import {
  mapCandidateTheme,
  mapShippedCandidateTheme,
  type CandidatePaintMapping,
  type LightTokenMap,
} from './candidate';
import type {RoleProfiles} from '../../color/role-profiles';
import type {
  NormalizedThemePair,
  ObservationVariant,
  SceneDefinition,
} from './types';

export interface ThemeVariantValues {
  values: Readonly<Record<ObservationVariant, Readonly<Record<string, string>>>>;
  candidateMappings: readonly CandidatePaintMapping[];
}

/** Build all render values while keeping authored dark outside the candidate mapper API. */
export function buildThemeVariantValues(
  theme: NormalizedThemePair,
  scenes: readonly SceneDefinition[],
): ThemeVariantValues {
  const lightTokens = themeLightTokens(theme);
  return buildThemeVariantValuesFromMappings(
    theme,
    scenes,
    mapShippedCandidateTheme(lightTokens, scenes),
  );
}

/** V2-only profile-injected builder; the complete profile set is mandatory. */
export function buildThemeVariantValuesWithProfiles(
  theme: NormalizedThemePair,
  scenes: readonly SceneDefinition[],
  profiles: RoleProfiles,
): ThemeVariantValues {
  const lightTokens = themeLightTokens(theme);
  const candidateMappings = mapCandidateTheme(lightTokens, scenes, profiles);
  return buildThemeVariantValuesFromMappings(theme, scenes, candidateMappings);
}

function themeLightTokens(theme: NormalizedThemePair): LightTokenMap {
  return Object.fromEntries(
    Object.entries(theme.tokens).map(([name, token]) => [name, token.light]),
  ) as LightTokenMap;
}

function buildThemeVariantValuesFromMappings(
  theme: NormalizedThemePair,
  scenes: readonly SceneDefinition[],
  candidateMappings: readonly CandidatePaintMapping[],
): ThemeVariantValues {
  const candidateById = new Map(candidateMappings.map((mapping) => [mapping.paintId, mapping]));
  if (candidateById.size !== candidateMappings.length) throw new Error('Duplicate candidate paint id');

  const light: Record<string, string> = {};
  const authoredDark: Record<string, string> = {};
  const baselineCandidate: Record<string, string> = {};
  const expected = new Set<string>();
  for (const scene of scenes) {
    for (const paint of scene.paints) {
      if (expected.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      expected.add(paint.id);
      const token = theme.tokens[paint.token];
      if (!token) throw new Error(`Missing normalized token ${paint.token}`);
      const candidate = candidateById.get(paint.id);
      if (!candidate) throw new Error(`Missing candidate paint ${paint.id}`);
      light[paint.id] = token.light;
      authoredDark[paint.id] = token.dark;
      baselineCandidate[paint.id] = candidate.mappedCss;
    }
  }
  for (const paintId of candidateById.keys()) {
    if (!expected.has(paintId)) throw new Error(`Unexpected candidate paint ${paintId}`);
  }
  return {
    values: {
      light: sortRecord(light),
      'authored-dark': sortRecord(authoredDark),
      'baseline-candidate': sortRecord(baselineCandidate),
    },
    candidateMappings,
  };
}

function sortRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ));
}
