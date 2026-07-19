import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {
  BASELINE_ROLE_PROFILES_SEMANTIC_SHA256,
  serializeRoleProfilesCanonical,
  validateRoleProfiles,
  type RoleProfiles,
} from '../../color/role-profiles';
import {sha256Text} from '../artifacts';

const BASELINE_PROFILE_PATH = 'fixtures/profiles/baseline-profile.v2.json';
export const BASELINE_ROLE_PROFILE_FILE_SHA256 =
  '0b7e66c6bc2281e3387fe5a9df6d57a62fcecb5f7948d39e224f99850d105f5f';
const ARTIFACT_KEYS = [
  '$schema',
  'schema',
  'id',
  'kind',
  'profiles',
  'semanticSha256',
] as const;

export interface LoadedBaselineRoleProfile {
  path: string;
  profiles: RoleProfiles;
  semanticSha256: string;
  fileSha256: string;
}

/** Load the pinned baseline artifact; evaluation never imports shipped defaults. */
export async function loadBaselineRoleProfile(
  repoRoot: string,
): Promise<LoadedBaselineRoleProfile> {
  const artifactPath = path.resolve(repoRoot, BASELINE_PROFILE_PATH);
  const bytes = await readFile(artifactPath, 'utf8');
  const fileSha256 = sha256Text(bytes);
  if (fileSha256 !== BASELINE_ROLE_PROFILE_FILE_SHA256) {
    throw new Error(`${artifactPath} does not match the pinned baseline file SHA-256`);
  }
  const artifact = parseObject(bytes, artifactPath);
  exactKeys(artifact, ARTIFACT_KEYS, artifactPath);
  if (artifact.$schema !== './role-profile.schema.json' ||
      artifact.schema !== 'semantic-dark.role-profile.v2' ||
      artifact.id !== 'semantic-dark.baseline-role-profile.v2' ||
      artifact.kind !== 'baseline') {
    throw new Error(`${artifactPath} has an unexpected baseline profile identity`);
  }
  if (artifact.semanticSha256 !== BASELINE_ROLE_PROFILES_SEMANTIC_SHA256) {
    throw new Error(`${artifactPath} does not declare the frozen M0 semantic hash`);
  }
  const profiles = validateRoleProfiles(artifact.profiles, `${artifactPath}.profiles`);
  const semanticSha256 = sha256Text(serializeRoleProfilesCanonical(profiles));
  if (semanticSha256 !== artifact.semanticSha256) {
    throw new Error(`${artifactPath} profile payload does not match semanticSha256`);
  }
  return {
    path: BASELINE_PROFILE_PATH,
    profiles,
    semanticSha256,
    fileSha256,
  };
}

function parseObject(bytes: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, {cause: error});
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must contain a JSON object`);
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
