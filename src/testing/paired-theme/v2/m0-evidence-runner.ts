import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access, mkdir, open, readFile, realpath, stat} from 'node:fs/promises';
import {arch, homedir, platform, release, tmpdir} from 'node:os';
import path from 'node:path';

import {deepFreeze} from './m0-validation-primitives';
import type {
  M0V2ArtifactPin,
  M0V2EvidenceCommand,
  M0V2EvidenceCompletion,
  M0V2EvidenceLabel,
  M0V2EvidenceReference,
  M0V2ToolIdentity,
} from './m0-types';

const DEFAULT_EVIDENCE_ROOT = path.join(
  homedir(), 'scratch-data', 'semantic-dark-pairs', 'logs', 'm0-v2',
);
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface RunM0V2EvidenceOptions {repoRoot: string; evidenceRoot?: string}
export interface M0V2EvidenceRun {
  reference: Readonly<M0V2EvidenceReference>;
  completion: Readonly<M0V2EvidenceCompletion>;
}

export async function runM0V2VerifyEvidence(
  options: RunM0V2EvidenceOptions,
): Promise<M0V2EvidenceRun> {
  return runFixedEvidence(options, 'verify', 'pnpm verify');
}

export async function runM0V2E2eEvidence(
  options: RunM0V2EvidenceOptions,
): Promise<M0V2EvidenceRun> {
  return runFixedEvidence(options, 'e2e', 'pnpm e2e');
}

/** Run the only permitted M0-v2 evidence suite, stopping after a failed verify. */
export async function runM0V2EvidenceSuite(options: RunM0V2EvidenceOptions): Promise<{
  verify: M0V2EvidenceRun;
  e2e: M0V2EvidenceRun;
}> {
  const verify = await runM0V2VerifyEvidence(options);
  assertPassed(verify);
  const e2e = await runM0V2E2eEvidence(options);
  assertPassed(e2e);
  return {verify, e2e};
}

function assertPassed(run: M0V2EvidenceRun): void {
  if (run.completion.outcome.status !== 'passed') {
    throw new Error(`${run.completion.command} failed; completion ${run.reference.completion.path}`);
  }
}

async function runFixedEvidence(
  options: RunM0V2EvidenceOptions,
  label: M0V2EvidenceLabel,
  command: M0V2EvidenceCommand,
): Promise<M0V2EvidenceRun> {
  const repoRoot = await realpath(path.resolve(options.repoRoot));
  const evidenceRootValue = options.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT;
  await mkdir(path.resolve(evidenceRootValue), {recursive: true, mode: 0o700});
  const evidenceRoot = await realpath(path.resolve(evidenceRootValue));
  const tools = await toolIdentities(command);
  const before = await gitSnapshot(repoRoot, tools.git.path);
  if (!before.clean) throw new Error('M0-v2 evidence requires a clean evaluator HEAD');

  const id = randomUUID();
  const logPath = path.join(evidenceRoot, `${label}.${id}.log`);
  const completionPath = path.join(evidenceRoot, `completion.${label}.${id}.json`);
  const logHandle = await open(logPath, 'wx', 0o600);
  await logHandle.sync();
  const env = childEnvironment(command, tools.chrome?.path ?? null);
  const script = label;
  const startedAt = new Date().toISOString();
  let exitCode: number | null = null;
  let signal: string | null = null;
  try {
    ({exitCode, signal} = await spawnLogged(
      tools.pnpm.path, [script], repoRoot, env, logHandle.fd,
    ));
  } catch (error) {
    await logHandle.write(`\nM0-v2 runner spawn failure: ${safeError(error)}\n`);
  } finally {
    await logHandle.sync();
    await logHandle.close();
  }
  const after = await gitSnapshot(repoRoot, tools.git.path);
  const cleanAfter = after.clean && after.head === before.head && after.tree === before.tree;
  const status = exitCode === 0 && signal === null && cleanAfter ? 'passed' : 'failed';
  const completion: M0V2EvidenceCompletion = {
    schema: 'semantic-dark.m0-evidence-completion.v2',
    id,
    command,
    startedAt,
    completedAt: new Date().toISOString(),
    argv: [tools.pnpm.path, script],
    cwd: repoRoot,
    env: recordedEnvironment(env, command),
    tools,
    runtime: {platform: platform(), architecture: arch(), osRelease: release()},
    git: {head: before.head, tree: before.tree, cleanBefore: true, cleanAfter},
    outcome: {exitCode, signal, status},
    log: await artifactPin(logPath),
  };
  const completionPin = await writeExclusiveCompletion(completionPath, completion);
  return deepFreeze({
    reference: {id, command, completion: completionPin},
    completion,
  });
}

async function toolIdentities(command: M0V2EvidenceCommand): Promise<M0V2EvidenceCompletion['tools']> {
  const envPath = process.env.PATH;
  if (!envPath) throw new Error('M0-v2 evidence requires PATH');
  const pnpmPath = await resolveExecutable('pnpm', envPath);
  const gitPath = await resolveExecutable('git', envPath);
  const baseEnv = {PATH: envPath, HOME: process.env.HOME ?? homedir()};
  const pnpm = {path: pnpmPath, version: await version(pnpmPath, ['--version'], baseEnv)};
  const git = {path: gitPath, version: await version(gitPath, ['--version'], baseEnv)};
  const node = {path: await realpath(process.execPath), version: process.version};
  let chrome: M0V2ToolIdentity | null = null;
  if (command === 'pnpm e2e') {
    const chromePath = await realpath(process.env.CHROME_PATH ?? DEFAULT_CHROME);
    chrome = {path: chromePath,
      version: normalizeChromeVersion(await version(chromePath, ['--version'], baseEnv))};
  }
  return {node, pnpm, git, chrome};
}

function childEnvironment(
  command: M0V2EvidenceCommand,
  chromePath: string | null,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    HOME: process.env.HOME ?? homedir(),
    PATH: process.env.PATH ?? '',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    CI: '1', FORCE_COLOR: '0', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'UTC',
  };
  if (command === 'pnpm e2e' && chromePath) result.CHROME_PATH = chromePath;
  return result;
}

function recordedEnvironment(
  env: NodeJS.ProcessEnv,
  command: M0V2EvidenceCommand,
): M0V2EvidenceCompletion['env'] {
  return {
    HOME: env.HOME!, PATH: env.PATH!, TMPDIR: env.TMPDIR!, CI: '1', FORCE_COLOR: '0',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'UTC',
    CHROME_PATH: command === 'pnpm e2e' ? env.CHROME_PATH! : null,
  };
}

async function spawnLogged(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  outputFd: number,
): Promise<{exitCode: number | null; signal: string | null}> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, env, stdio: ['ignore', outputFd, outputFd]});
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({exitCode, signal}));
  });
}

async function gitSnapshot(root: string, gitPath: string) {
  const [top, head, tree, status] = await Promise.all([
    output(gitPath, ['rev-parse', '--show-toplevel'], root),
    output(gitPath, ['rev-parse', 'HEAD'], root),
    output(gitPath, ['rev-parse', 'HEAD^{tree}'], root),
    output(gitPath, ['status', '--porcelain=v1', '--untracked-files=all'], root, undefined, true),
  ]);
  if (await realpath(top) !== root) throw new Error('M0-v2 repoRoot must be the Git root');
  return {head, tree, clean: status.length === 0};
}

async function version(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return output(executable, args, undefined, env);
}

async function output(
  executable: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  allowEmpty = false,
): Promise<string> {
  const child = await import('node:child_process');
  const result = child.execFileSync(executable, args, {cwd, env, encoding: 'utf8'}).trim();
  if (!result && !allowEmpty) throw new Error(`${executable} returned empty output`);
  return result;
}

async function resolveExecutable(name: string, pathValue: string): Promise<string> {
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return realpath(candidate);
    } catch {}
  }
  throw new Error(`M0-v2 evidence cannot resolve ${name}`);
}

async function writeExclusiveCompletion(
  file: string,
  completion: M0V2EvidenceCompletion,
): Promise<M0V2ArtifactPin> {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(completion, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return artifactPin(file);
}

async function artifactPin(file: string): Promise<M0V2ArtifactPin> {
  const [bytes, metadata] = await Promise.all([readFile(file), stat(file)]);
  if (!metadata.isFile()) throw new Error(`M0-v2 evidence is not a regular file: ${file}`);
  return {path: file, byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')};
}

function normalizeChromeVersion(value: string): string {
  const match = value.match(/\d+(?:\.\d+){3}/);
  if (!match) throw new Error(`Chrome returned an invalid version: ${value}`);
  return match[0];
}

function safeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
