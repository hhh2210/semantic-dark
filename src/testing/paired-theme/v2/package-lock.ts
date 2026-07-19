import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {parseDocument} from 'yaml';

import type {PackagePin} from '../types';

export interface VerifiedV2PackageLock {
  path: string;
  sha256: string;
  packages: readonly string[];
}

/** Verify exact protocol package pins without importing packages or reading token values. */
export async function verifyV2PackageLock(
  repoRoot: string,
  pins: readonly PackagePin[],
): Promise<Readonly<VerifiedV2PackageLock>> {
  if (pins.length === 0) throw new Error('V2 protocol must declare at least one package pin');
  const lockPath = await realpath(path.join(repoRoot, 'pnpm-lock.yaml'));
  if (path.relative(repoRoot, lockPath) !== 'pnpm-lock.yaml') {
    throw new Error('V2 pnpm lockfile must be a regular file inside the repository root');
  }
  const bytes = await readFile(lockPath);
  const root = parseLockfile(Buffer.from(bytes).toString('utf8'));
  if (root.lockfileVersion !== '9.0') {
    throw new Error('V2 package verification requires pnpm lockfileVersion 9.0');
  }
  const packages = object(root.packages, 'V2 pnpm lockfile packages');

  const keys = pins.map((pin) => `${pin.name}@${pin.version}`);
  if (new Set(keys).size !== keys.length) throw new Error('V2 package pins must be unique');
  for (const [index, pin] of pins.entries()) {
    const key = keys[index]!;
    const entry = object(packages[key], `V2 pnpm package entry ${key}`);
    const resolution = object(entry.resolution, `V2 pnpm resolution ${key}`);
    const integrity = sha512Integrity(resolution.integrity, key);
    if (integrity !== pin.integrity) {
      throw new Error(`V2 pnpm lockfile integrity differs for ${key}`);
    }
  }
  return Object.freeze({
    path: lockPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    packages: Object.freeze([...keys]),
  });
}

function parseLockfile(text: string): Record<string, unknown> {
  const document = parseDocument(text, {strict: true, uniqueKeys: true});
  if (document.errors.length > 0) {
    throw new Error(`V2 pnpm lockfile is invalid YAML: ${document.errors[0]!.message}`);
  }
  try {
    return object(document.toJS({maxAliasCount: 0}), 'V2 pnpm lockfile');
  } catch (error) {
    throw new Error(`V2 pnpm lockfile cannot use aliases: ${String(error)}`);
  }
}

function sha512Integrity(value: unknown, key: string): string {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`V2 pnpm lockfile has invalid SHA-512 integrity for ${key}`);
  }
  const encoded = value.slice('sha512-'.length);
  const digest = Buffer.from(encoded, 'base64');
  if (digest.length !== 64 || digest.toString('base64') !== encoded) {
    throw new Error(`V2 pnpm lockfile has invalid SHA-512 integrity for ${key}`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
