import type {RoleProfiles} from '../../../color/role-profiles';
import {
  mapCandidateTheme,
  type CandidatePaintMapping,
  type LightTokenMap,
} from '../candidate';
import type {NormalizedThemePair, SceneDefinition} from '../types';
import type {V2VariantRoles} from './contract';

export interface V2ThemeVariantValues {
  values: Readonly<Record<string, Readonly<Record<string, string>>>>;
  mappings: {
    baseline: readonly CandidatePaintMapping[];
    candidate: readonly CandidatePaintMapping[];
  };
}

/** Build the four spec-named render conditions without exposing authored dark to either mapper. */
export function buildV2ThemeVariantValues(
  theme: Pick<NormalizedThemePair, 'tokens'>,
  scenes: readonly SceneDefinition[],
  baselineProfiles: RoleProfiles,
  candidateProfiles: RoleProfiles,
  roles: V2VariantRoles,
): V2ThemeVariantValues {
  assertDistinctRoles(roles);
  const lightTokens = themeLightTokens(theme);
  const baseline = mapCandidateTheme(lightTokens, scenes, baselineProfiles);
  const candidate = mapCandidateTheme(lightTokens, scenes, candidateProfiles);
  const source = sourceValues(theme, scenes);
  return {
    values: {
      [roles.light]: source.light,
      [roles.authoredDark]: source.authoredDark,
      [roles.baselineCandidate]: mappingValues(baseline, source.paintIds, 'baseline'),
      [roles.m2Candidate]: mappingValues(candidate, source.paintIds, 'candidate'),
    },
    mappings: {baseline, candidate},
  };
}

function themeLightTokens(theme: Pick<NormalizedThemePair, 'tokens'>): LightTokenMap {
  return Object.fromEntries(
    Object.entries(theme.tokens).map(([name, token]) => [name, token.light]),
  ) as LightTokenMap;
}

function sourceValues(
  theme: Pick<NormalizedThemePair, 'tokens'>,
  scenes: readonly SceneDefinition[],
): {light: Record<string, string>; authoredDark: Record<string, string>; paintIds: ReadonlySet<string>} {
  const light: Record<string, string> = {};
  const authoredDark: Record<string, string> = {};
  const paintIds = new Set<string>();
  for (const scene of scenes) {
    for (const paint of scene.paints) {
      if (paintIds.has(paint.id)) throw new Error(`Duplicate paint id: ${paint.id}`);
      paintIds.add(paint.id);
      const token = theme.tokens[paint.token];
      if (!token) throw new Error(`Missing normalized token ${paint.token}`);
      light[paint.id] = token.light;
      authoredDark[paint.id] = token.dark;
    }
  }
  return {light: sortRecord(light), authoredDark: sortRecord(authoredDark), paintIds};
}

function mappingValues(
  mappings: readonly CandidatePaintMapping[],
  expected: ReadonlySet<string>,
  label: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const mapping of mappings) {
    if (!expected.has(mapping.paintId)) throw new Error(`Unexpected ${label} paint ${mapping.paintId}`);
    if (Object.prototype.hasOwnProperty.call(values, mapping.paintId)) {
      throw new Error(`Duplicate ${label} paint ${mapping.paintId}`);
    }
    values[mapping.paintId] = mapping.mappedCss;
  }
  for (const paintId of expected) {
    if (!Object.prototype.hasOwnProperty.call(values, paintId)) {
      throw new Error(`Missing ${label} paint ${paintId}`);
    }
  }
  return sortRecord(values);
}

function assertDistinctRoles(roles: V2VariantRoles): void {
  const values = [roles.light, roles.authoredDark, roles.baselineCandidate, roles.m2Candidate];
  if (values.some((value) => typeof value !== 'string' || value.length === 0) ||
      new Set(values).size !== values.length) {
    throw new Error('V2 variant roles must be four distinct non-empty names');
  }
}

function sortRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  ));
}
