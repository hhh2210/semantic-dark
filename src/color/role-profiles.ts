export const COLOR_ROLES = [
  'background',
  'surface',
  'text',
  'border',
  'accent',
  'svgFill',
  'svgStroke',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export interface RoleProfile {
  minimumLightness: number;
  lightnessSpan: number;
  chromaScale: number;
}

export type RoleProfiles = Readonly<Record<ColorRole, Readonly<RoleProfile>>>;

export const BASELINE_ROLE_PROFILES_SEMANTIC_SHA256 =
  'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5';

const PROFILE_KEYS = ['minimumLightness', 'lightnessSpan', 'chromaScale'] as const;

/** Validate a complete profile set and return an immutable canonical copy. */
export function validateRoleProfiles(value: unknown, label = 'role profiles'): RoleProfiles {
  const input = object(value, label);
  exactKeys(input, COLOR_ROLES, label);
  const entries = COLOR_ROLES.map((role) => {
    const profile = object(input[role], `${label}.${role}`);
    exactKeys(profile, PROFILE_KEYS, `${label}.${role}`);
    const minimumLightness = unit(profile.minimumLightness, `${label}.${role}.minimumLightness`);
    const lightnessSpan = unit(profile.lightnessSpan, `${label}.${role}.lightnessSpan`);
    const chromaScale = unit(profile.chromaScale, `${label}.${role}.chromaScale`);
    if (minimumLightness + lightnessSpan > 1) {
      throw new RangeError(`${label}.${role} lightness band must stay in [0, 1]`);
    }
    return [role, Object.freeze({minimumLightness, lightnessSpan, chromaScale})] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as RoleProfiles;
}

/**
 * Stable semantic serialization used by the M0 profile identity. Role and
 * field order are intentional; this preserves the existing M0 digest.
 */
export function serializeRoleProfilesCanonical(value: unknown): string {
  return JSON.stringify(validateRoleProfiles(value));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function unit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be finite and in [0, 1]`);
  }
  return value;
}
