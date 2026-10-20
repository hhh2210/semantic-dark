import {execFile as execFileCallback} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {readGitTreeSha1} from './m0-pin-closure';
import {
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  type M0V2ArtifactPin,
  type M0V2Manifest,
} from './m0-types';

const execFile = promisify(execFileCallback);

export interface VerifiedM0V2Artifact extends M0V2ArtifactPin {
  resolvedPath: string;
  bytes: Buffer;
}

export async function assertM0V2GitRoot(root: string): Promise<void> {
  const stdout = (await execFile('git', ['rev-parse', '--show-toplevel'], {cwd: root})).stdout;
  if (await realpath(stdout.trim()) !== root) throw new Error('M0-v2 repoRoot must be the Git root');
}

export async function assertM0V2CommitLineage(
  root: string,
  document: Readonly<M0V2Manifest>,
): Promise<void> {
  const evaluator = document.commits.evaluator;
  if (evaluator === M0_V2_ENGINE_INTERVENTION_COMMIT) {
    throw new Error('M0-v2 evaluator commit must be distinct from the engine intervention commit');
  }
  await git(root, ['cat-file', '-e', `${M0_V2_ENGINE_INTERVENTION_COMMIT}^{commit}`],
    'engine intervention commit is unavailable');
  await git(root, ['cat-file', '-e', `${evaluator}^{commit}`],
    'evaluator commit is unavailable');
  await git(root, ['merge-base', '--is-ancestor', M0_V2_ENGINE_INTERVENTION_COMMIT, evaluator],
    'engine intervention commit is not an ancestor of evaluator commit');
  await git(root, ['merge-base', '--is-ancestor', evaluator, 'HEAD'],
    'evaluator commit is not an ancestor of the current checkout');
  const evaluatorTree = await readGitTreeSha1(root, evaluator);
  if (evaluatorTree !== document.implementationPins.evaluatorTreeSha1) {
    throw new Error('M0-v2 evaluator tree SHA-1 mismatch');
  }
}

export async function verifyM0V2ImplementationPins(
  root: string,
  document: Readonly<M0V2Manifest>,
): Promise<void> {
  for (const pin of document.implementationPins.files) {
    await verifyM0V2RepositoryPin(root, pin.path, pin.sha256,
      `implementation pin ${pin.path}`);
    if (pin.commitRole === 'engine') {
      await verifyM0V2GitBlob(root, document.commits.engineIntervention,
        pin.path, pin.sha256, `${pin.path} at engine commit`);
      await verifyM0V2GitBlob(root, document.commits.evaluator,
        pin.path, pin.sha256, `${pin.path} unchanged at evaluator commit`);
    } else {
      await verifyM0V2GitBlob(root, document.commits.evaluator,
        pin.path, pin.sha256, `${pin.path} at evaluator commit`);
    }
  }
}

export async function verifyM0V2RepositoryPin(
  root: string,
  relative: string,
  expected: string,
  label: string,
): Promise<string> {
  const file = await containedM0V2RepoFile(root, relative, label);
  if (sha256(await readFile(file)) !== expected) throw new Error(`${label} SHA-256 mismatch`);
  return file;
}

export async function verifyM0V2GitBlob(
  root: string,
  commit: string,
  relative: string,
  expected: string,
  label: string,
): Promise<void> {
  let stdout: Buffer;
  try {
    stdout = (await execFile('git', ['show', `${commit}:${relative}`], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    })).stdout as Buffer;
  } catch (error) {
    throw new Error(`${label} cannot be read from Git`, {cause: error});
  }
  if (sha256(stdout) !== expected) throw new Error(`${label} SHA-256 mismatch`);
}

export async function verifyM0V2ExternalArtifact(
  root: string,
  pin: M0V2ArtifactPin,
  label: string,
  basename: string,
): Promise<VerifiedM0V2Artifact> {
  const candidate = await containedM0V2ExternalFile(root, pin.path, label);
  if (path.basename(candidate) !== basename) throw new Error(`${label} has an unexpected filename`);
  const [bytes, metadata] = await Promise.all([readFile(candidate), stat(candidate)]);
  if (!metadata.isFile() || bytes.byteLength !== pin.byteLength || sha256(bytes) !== pin.sha256) {
    throw new Error(`${label} bytes do not match their pin`);
  }
  return {...pin, resolvedPath: candidate, bytes};
}

export async function containedM0V2RepoFile(
  root: string,
  relative: string,
  label: string,
): Promise<string> {
  if (path.isAbsolute(relative) || relative.includes('\\') ||
      path.posix.normalize(relative) !== relative || relative.split('/').includes('..')) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  return containedM0V2ExternalFile(root, path.resolve(root, relative), label);
}

export async function containedM0V2ExternalFile(
  root: string,
  candidateValue: string,
  label: string,
): Promise<string> {
  const candidate = await realpath(path.resolve(candidateValue));
  const fromRoot = path.relative(root, candidate);
  if (fromRoot === '' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes its trusted root`);
  }
  return candidate;
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function git(root: string, args: string[], failure: string): Promise<void> {
  try { await execFile('git', args, {cwd: root}); } catch (error) {
    throw new Error(failure, {cause: error});
  }
}
