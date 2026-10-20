import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';

import {serializeCanonicalJson, sha256Text} from '../../artifacts';
import {
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  type M0V2ImplementationPin,
  type M0V2PinClosureEntry,
} from './m0-types';

const execFile = promisify(execFileCallback);
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Derive the implementation closure from committed trees, never the mutable
 * working directory. Engine paths are frozen at E; evaluator paths are frozen
 * at F and the complete F tree is bound separately by the manifest.
 */
export async function discoverM0V2PinClosure(
  repoRoot: string,
  evaluatorCommit: string,
): Promise<readonly M0V2PinClosureEntry[]> {
  if (!COMMIT.test(evaluatorCommit)) throw new TypeError('M0-v2 evaluator commit is invalid');
  const [engineTree, evaluatorTree] = await Promise.all([
    listTree(repoRoot, M0_V2_ENGINE_INTERVENTION_COMMIT),
    listTree(repoRoot, evaluatorCommit),
  ]);
  const enginePaths = engineTree.filter(isEngineClosurePath).sort();
  const evaluatorPaths = evaluatorTree.filter(isEvaluatorClosurePath).sort();
  requireClosureFamilies(enginePaths, evaluatorPaths);
  const engineSet = new Set(enginePaths);
  const duplicate = evaluatorPaths.find((file) => engineSet.has(file));
  if (duplicate) throw new Error(`M0-v2 pin closure assigns ${duplicate} twice`);
  return Object.freeze([
    ...enginePaths.map((file) => Object.freeze({path: file, commitRole: 'engine' as const})),
    ...evaluatorPaths.map((file) => Object.freeze({path: file, commitRole: 'evaluator' as const})),
  ]);
}

export function m0V2ImplementationPinSetSha256(
  files: readonly M0V2ImplementationPin[],
  evaluatorTreeSha1 = '',
): string {
  return sha256Text(serializeCanonicalJson({evaluatorTreeSha1, files}));
}

export async function readGitTreeSha1(repoRoot: string, commit: string): Promise<string> {
  if (!COMMIT.test(commit)) throw new TypeError('M0-v2 Git commit is invalid');
  const value = (await execFile('git', ['rev-parse', `${commit}^{tree}`], {
    cwd: repoRoot,
  })).stdout.trim();
  if (!COMMIT.test(value)) throw new Error(`Git returned an invalid tree for ${commit}`);
  return value;
}

async function listTree(repoRoot: string, commit: string): Promise<string[]> {
  let stdout: string;
  try {
    stdout = (await execFile('git', ['ls-tree', '-r', '--name-only', commit], {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024,
    })).stdout;
  } catch (error) {
    throw new Error(`Cannot enumerate M0-v2 commit ${commit}`, {cause: error});
  }
  return stdout.split('\n').filter(Boolean);
}

function isEngineClosurePath(file: string): boolean {
  return (file.startsWith('src/') && !file.startsWith('src/testing/')) ||
    file.startsWith('src/testing/e2e/') ||
    file.startsWith('fixtures/integration/') ||
    file.startsWith('fixtures/svg/') ||
    file.startsWith('extension/') ||
    (file.startsWith('tests/') && !file.startsWith('tests/testing/paired-theme')) ||
    file === 'scripts/build.mjs' || file === 'scripts/e2e.mjs' ||
    file === '.github/workflows/verify.yml' || file === 'tsconfig.json' ||
    file === 'vitest.config.ts' || file === 'pnpm-workspace.yaml';
}

function isEvaluatorClosurePath(file: string): boolean {
  return file === 'src/testing/artifacts.ts' ||
    file.startsWith('src/testing/paired-theme/') ||
    file.startsWith('fixtures/paired-theme/') ||
    file === 'fixtures/profiles/baseline-profile.v2.json' ||
    file === 'fixtures/profiles/role-profile.schema.json' ||
    /^fixtures\/evaluation\/.*v2.*\.schema\.json$/.test(file) ||
    /^scripts\/(?:paired-theme.*|m0-v2-evidence)\.(?:ts|mjs)$/.test(file) ||
    /^tests\/testing\/(?:helpers\/v2-.*|paired-theme.*)\.(?:ts|mjs)$/.test(file) ||
    file === 'package.json' || file === 'pnpm-lock.yaml';
}

function requireClosureFamilies(engine: readonly string[], evaluator: readonly string[]): void {
  const requiredEngine = [
    'src/color/dark-map.ts', 'src/content/index.ts', 'src/raster/index.ts',
    'src/svg/index.ts', 'scripts/build.mjs', 'scripts/e2e.mjs',
    'src/testing/e2e/chrome-session.mjs', 'fixtures/integration/index.html',
    'extension/manifest.json', 'tsconfig.json', 'vitest.config.ts',
  ];
  const requiredEvaluator = [
    'src/testing/paired-theme/material.ts', 'src/testing/paired-theme/primer.ts',
    'src/testing/paired-theme/spectrum.ts',
    'src/testing/paired-theme/spectrum-resolver.ts',
    'src/testing/paired-theme/v2/adapter-registry.ts',
    'src/testing/paired-theme/v2/m0-manifest.ts',
    'fixtures/paired-theme/v2/material.protocol.json',
    'package.json', 'pnpm-lock.yaml',
  ];
  for (const file of requiredEngine) {
    if (!engine.includes(file)) throw new Error(`M0-v2 engine closure misses ${file}`);
  }
  for (const file of requiredEvaluator) {
    if (!evaluator.includes(file)) throw new Error(`M0-v2 evaluator closure misses ${file}`);
  }
}
