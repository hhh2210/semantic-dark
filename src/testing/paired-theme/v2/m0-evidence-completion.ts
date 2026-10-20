import path from 'node:path';

import type {
  M0V2ArtifactPin,
  M0V2EvidenceCommand,
  M0V2EvidenceCompletion,
  M0V2ToolIdentity,
} from './m0-types';
import {
  boolean,
  canonicalTimestamp,
  deepFreeze,
  exactKeys,
  literal,
  match,
  nonEmpty,
  nonNegativeInteger,
  object,
  sha1Digest,
  sha256Digest,
  UUID_V4_PATTERN,
} from './m0-validation-primitives';

export function validateM0V2EvidenceCompletion(
  value: unknown,
): Readonly<M0V2EvidenceCompletion> {
  const input = object(value, 'M0-v2 evidence completion');
  exactKeys(input, ['schema', 'id', 'command', 'startedAt', 'completedAt', 'argv',
    'cwd', 'env', 'tools', 'runtime', 'git', 'outcome', 'log'],
  'M0-v2 evidence completion');
  literal(input.schema, 'semantic-dark.m0-evidence-completion.v2', 'completion.schema');
  const id = match(input.id, UUID_V4_PATTERN, 'completion.id');
  const command = evidenceCommand(input.command);
  const startedAt = canonicalTimestamp(input.startedAt, 'completion.startedAt');
  const completedAt = canonicalTimestamp(input.completedAt, 'completion.completedAt');
  if (completedAt < startedAt) throw new Error('M0-v2 completion precedes its start');
  const tools = validateTools(input.tools, command);
  const argv = validateArgv(input.argv, command, tools.pnpm.path);
  const env = validateEnvironment(input.env, command, tools.chrome?.path ?? null);
  const git = validateGit(input.git);
  const outcome = validateOutcome(input.outcome, git);
  return deepFreeze({
    schema: 'semantic-dark.m0-evidence-completion.v2', id, command,
    startedAt, completedAt, argv, cwd: absolute(input.cwd, 'completion.cwd'),
    env, tools, runtime: validateRuntime(input.runtime), git, outcome,
    log: artifactPin(input.log, 'completion.log'),
  });
}

function validateRuntime(value: unknown): M0V2EvidenceCompletion['runtime'] {
  const input = object(value, 'completion.runtime');
  exactKeys(input, ['platform', 'architecture', 'osRelease'], 'completion.runtime');
  return {platform: nonEmpty(input.platform, 'completion.runtime.platform'),
    architecture: nonEmpty(input.architecture, 'completion.runtime.architecture'),
    osRelease: nonEmpty(input.osRelease, 'completion.runtime.osRelease')};
}

function evidenceCommand(value: unknown): M0V2EvidenceCommand {
  if (value !== 'pnpm verify' && value !== 'pnpm e2e') {
    throw new Error('M0-v2 completion command is not fixed');
  }
  return value;
}

function validateArgv(
  value: unknown,
  command: M0V2EvidenceCommand,
  pnpmPath: string,
): [string, 'verify' | 'e2e'] {
  const script = command === 'pnpm verify' ? 'verify' : 'e2e';
  if (!Array.isArray(value) || value.length !== 2 ||
      value[0] !== pnpmPath || value[1] !== script) {
    throw new Error(`M0-v2 completion argv must be the resolved pnpm ${script} command`);
  }
  return [pnpmPath, script];
}

function validateEnvironment(
  value: unknown,
  command: M0V2EvidenceCommand,
  chromePath: string | null,
): M0V2EvidenceCompletion['env'] {
  const input = object(value, 'completion.env');
  exactKeys(input, ['HOME', 'PATH', 'TMPDIR', 'CI', 'FORCE_COLOR', 'LANG', 'LC_ALL',
    'TZ', 'CHROME_PATH'], 'completion.env');
  const recordedChrome = input.CHROME_PATH === null
    ? null : path.resolve(nonEmpty(input.CHROME_PATH, 'completion.env.CHROME_PATH'));
  if (recordedChrome !== chromePath ||
      (command === 'pnpm e2e' && recordedChrome === null) ||
      (command === 'pnpm verify' && recordedChrome !== null)) {
    throw new Error('M0-v2 completion Chrome environment disagrees with its command');
  }
  return {
    HOME: nonEmpty(input.HOME, 'completion.env.HOME'),
    PATH: nonEmpty(input.PATH, 'completion.env.PATH'),
    TMPDIR: nonEmpty(input.TMPDIR, 'completion.env.TMPDIR'),
    CI: literal(input.CI, '1', 'completion.env.CI'),
    FORCE_COLOR: literal(input.FORCE_COLOR, '0', 'completion.env.FORCE_COLOR'),
    LANG: literal(input.LANG, 'en_US.UTF-8', 'completion.env.LANG'),
    LC_ALL: literal(input.LC_ALL, 'en_US.UTF-8', 'completion.env.LC_ALL'),
    TZ: literal(input.TZ, 'UTC', 'completion.env.TZ'),
    CHROME_PATH: recordedChrome,
  };
}

function validateTools(
  value: unknown,
  command: M0V2EvidenceCommand,
): M0V2EvidenceCompletion['tools'] {
  const input = object(value, 'completion.tools');
  exactKeys(input, ['node', 'pnpm', 'git', 'chrome'], 'completion.tools');
  const chrome = input.chrome === null ? null : tool(input.chrome, 'completion.tools.chrome');
  if ((command === 'pnpm e2e') !== (chrome !== null)) {
    throw new Error('M0-v2 completion must record Chrome only for e2e');
  }
  return {node: tool(input.node, 'completion.tools.node'),
    pnpm: tool(input.pnpm, 'completion.tools.pnpm'),
    git: tool(input.git, 'completion.tools.git'), chrome};
}

function tool(value: unknown, label: string): M0V2ToolIdentity {
  const input = object(value, label);
  exactKeys(input, ['path', 'version'], label);
  return {path: absolute(input.path, `${label}.path`),
    version: nonEmpty(input.version, `${label}.version`)};
}

function validateGit(value: unknown): M0V2EvidenceCompletion['git'] {
  const input = object(value, 'completion.git');
  exactKeys(input, ['head', 'tree', 'cleanBefore', 'cleanAfter'], 'completion.git');
  return {head: sha1Digest(input.head, 'completion.git.head'),
    tree: sha1Digest(input.tree, 'completion.git.tree'),
    cleanBefore: boolean(input.cleanBefore, 'completion.git.cleanBefore'),
    cleanAfter: boolean(input.cleanAfter, 'completion.git.cleanAfter')};
}

function validateOutcome(
  value: unknown,
  git: M0V2EvidenceCompletion['git'],
): M0V2EvidenceCompletion['outcome'] {
  const input = object(value, 'completion.outcome');
  exactKeys(input, ['exitCode', 'signal', 'status'], 'completion.outcome');
  const exitCode = input.exitCode === null
    ? null : nonNegativeInteger(input.exitCode, 'completion.outcome.exitCode');
  const signal = input.signal === null ? null : nonEmpty(input.signal, 'completion.outcome.signal');
  const expected = exitCode === 0 && signal === null && git.cleanBefore && git.cleanAfter
    ? 'passed' : 'failed';
  literal(input.status, expected, 'completion.outcome.status');
  return {exitCode, signal, status: expected};
}

function artifactPin(value: unknown, label: string): M0V2ArtifactPin {
  const input = object(value, label);
  exactKeys(input, ['path', 'byteLength', 'sha256'], label);
  const byteLength = input.byteLength === 0
    ? 0 : nonNegativeInteger(input.byteLength, `${label}.byteLength`);
  return {path: absolute(input.path, `${label}.path`), byteLength,
    sha256: sha256Digest(input.sha256, `${label}.sha256`)};
}

function absolute(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (!path.isAbsolute(result)) throw new Error(`${label} must be absolute`);
  return path.resolve(result);
}
