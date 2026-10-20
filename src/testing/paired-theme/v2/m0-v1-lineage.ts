import {readFile} from 'node:fs/promises';

import {
  BASELINE_ROLE_PROFILES_SEMANTIC_SHA256,
  serializeRoleProfilesCanonical,
  validateRoleProfiles,
} from '../../../color/role-profiles';
import {sha256Text} from '../../artifacts';
import {loadBaselineRoleProfile} from '../profile-fixture';
import {M0_V1_MANIFEST_SHA256} from './m0-types';
import {exactKeys, literal, object, sha256Digest} from './m0-validation-primitives';

export interface M0V1ProfileLineage {
  manifestSha256: string;
  declaredCanonicalSha256: string;
  computedCanonicalSha256: string;
}

/** Prove the new fixture preserves the values authenticated by the pinned v1 manifest. */
export async function verifyM0V1ProfileLineage(
  repoRoot: string,
  predecessorPath: string,
): Promise<Readonly<M0V1ProfileLineage>> {
  const bytes = await readFile(predecessorPath);
  const manifestSha256 = sha256Text(bytes.toString('utf8'));
  if (manifestSha256 !== M0_V1_MANIFEST_SHA256) {
    throw new Error('Historical M0-v1 manifest SHA-256 mismatch');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')) as unknown; } catch (error) {
    throw new Error('Historical M0-v1 manifest is invalid JSON', {cause: error});
  }
  const manifest = object(parsed, 'historical M0-v1 manifest');
  literal(manifest.schema, 'semantic-dark.m0-manifest.v1', 'historical M0-v1 schema');
  const roleProfiles = object(manifest.role_profiles, 'historical M0-v1 role_profiles');
  exactKeys(roleProfiles, ['source', 'source_sha256', 'canonical_sha256', 'values'],
    'historical M0-v1 role_profiles');
  const declaredCanonicalSha256 = sha256Digest(
    roleProfiles.canonical_sha256,
    'historical M0-v1 role_profiles.canonical_sha256',
  );
  const values = validateRoleProfiles(roleProfiles.values, 'historical M0-v1 role_profiles.values');
  const computedCanonicalSha256 = sha256Text(serializeRoleProfilesCanonical(values));
  if (computedCanonicalSha256 !== declaredCanonicalSha256 ||
      computedCanonicalSha256 !== BASELINE_ROLE_PROFILES_SEMANTIC_SHA256) {
    throw new Error('Historical M0-v1 role profile values do not match their canonical pin');
  }
  const baseline = await loadBaselineRoleProfile(repoRoot);
  if (baseline.semanticSha256 !== declaredCanonicalSha256 ||
      serializeRoleProfilesCanonical(baseline.profiles) !== serializeRoleProfilesCanonical(values)) {
    throw new Error('M0-v2 baseline profile differs from hash-pinned M0-v1 values');
  }
  return Object.freeze({manifestSha256, declaredCanonicalSha256, computedCanonicalSha256});
}
