import {execFile as execFileCallback} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, cp, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {PNG} from 'pngjs';

import {runM0V2E2eEvidence, runM0V2VerifyEvidence} from
  '../../../src/testing/paired-theme/v2/m0-evidence-runner';
import {
  M0_V2_A3_EXPECTED,
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  M0_V2_MANIFEST_PATH,
  discoverM0V2PinClosure,
  m0V2ImplementationPinSetSha256,
  readGitTreeSha1,
  type M0V2ArtifactPin,
  type M0V2Manifest,
} from '../../../src/testing/paired-theme/v2/m0-manifest-contract';

const execFile = promisify(execFileCallback);
const SOURCE_ROOT = process.cwd();

export interface M0V2Fixture {
  root: string;
  repo: string;
  logs: string;
  probe: string;
  evaluatorCommit: string;
  evaluatorTreeSha1: string;
  manifest: M0V2Manifest;
  expectedSha256: string;
}

export async function makeM0V2Fixture(): Promise<M0V2Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-dark-m0-v2-'));
  const repo = path.join(root, 'repo');
  const logs = path.join(root, 'logs');
  const probe = path.join(root, 'probe');
  const bin = path.join(root, 'bin');
  await execFile('git', ['clone', '--shared', '--no-checkout', SOURCE_ROOT, repo]);
  await git(repo, ['checkout', '--detach', M0_V2_ENGINE_INTERVENTION_COMMIT]);
  await copyEvaluatorFiles(repo);
  await git(repo, ['config', 'user.name', 'M0 v2 test']);
  await git(repo, ['config', 'user.email', 'm0-v2@example.invalid']);
  await git(repo, ['add', 'src/testing', 'fixtures', 'scripts/m0-v2-evidence.ts',
    'package.json', 'pnpm-lock.yaml']);
  await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '--no-verify',
    '-m', 'test: freeze evaluator']);
  const evaluatorCommit = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const evaluatorTreeSha1 = await readGitTreeSha1(repo, evaluatorCommit);
  const closure = await discoverM0V2PinClosure(repo, evaluatorCommit);
  const files = await Promise.all(closure.map(async (entry) => {
    const commit = entry.commitRole === 'engine'
      ? M0_V2_ENGINE_INTERVENTION_COMMIT : evaluatorCommit;
    return {...entry, sha256: sha256(await gitBuffer(repo, ['show', `${commit}:${entry.path}`]))};
  }));

  await Promise.all([mkdir(logs), mkdir(probe), mkdir(bin)]);
  const chromePath = await writeFakeTools(bin);
  const oldPath = process.env.PATH;
  const oldChrome = process.env.CHROME_PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ''}`;
  process.env.CHROME_PATH = chromePath;
  let verify;
  let e2e;
  try {
    verify = await runM0V2VerifyEvidence({repoRoot: repo, evidenceRoot: logs});
    e2e = await runM0V2E2eEvidence({repoRoot: repo, evidenceRoot: logs});
  } finally {
    restoreEnv('PATH', oldPath);
    restoreEnv('CHROME_PATH', oldChrome);
  }
  const a3Artifacts = await writeProbeArtifacts(probe);
  const completed = [verify.completion.completedAt, e2e.completion.completedAt].sort().at(-1)!;
  const manifest: M0V2Manifest = {
    $schema: './m0-manifest.v2.schema.json',
    schema: 'semantic-dark.m0-manifest.v2',
    id: 'semantic-dark.m0-v2-baseline',
    status: 'frozen',
    recordedAt: new Date(new Date(completed).valueOf() + 1).toISOString(),
    predecessor: {schema: 'semantic-dark.m0-manifest.v1',
      path: 'fixtures/evaluation/m0-manifest.v1.json',
      sha256: '69efa054f742c58b7c69e6d64bca51e04e67ef730ac67ac980a3ddff854bb205'},
    baselineProfile: {path: 'fixtures/profiles/baseline-profile.v2.json',
      fileSha256: '0b7e66c6bc2281e3387fe5a9df6d57a62fcecb5f7948d39e224f99850d105f5f',
      semanticSha256: 'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5'},
    commits: {engineIntervention: M0_V2_ENGINE_INTERVENTION_COMMIT, evaluator: evaluatorCommit},
    implementationPins: {evaluatorTreeSha1,
      pinSetSha256: m0V2ImplementationPinSetSha256(files, evaluatorTreeSha1), files},
    evidence: {verify: verify.reference, e2e: e2e.reference},
    environment: {platform: verify.completion.runtime.platform,
      architecture: verify.completion.runtime.architecture,
      osRelease: verify.completion.runtime.osRelease,
      nodeVersion: verify.completion.tools.node.version,
      pnpmVersion: verify.completion.tools.pnpm.version,
      chromeVersion: e2e.completion.tools.chrome!.version,
      headless: true, locale: 'en-US', colorProfile: 'srgb',
      renderViewport: {width: 1280, height: 900, deviceScaleFactor: 1},
      a3ProbeViewport: {width: 220, height: 100, deviceScaleFactor: 1}},
    a3: {...structuredClone(M0_V2_A3_EXPECTED), artifacts: a3Artifacts},
  };
  const expectedSha256 = await writeM0V2Manifest(repo, manifest);
  return {root, repo, logs, probe, evaluatorCommit, evaluatorTreeSha1,
    manifest, expectedSha256};
}

export async function writeM0V2Manifest(repo: string, manifest: M0V2Manifest) {
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(repo, M0_V2_MANIFEST_PATH), bytes);
  return sha256(bytes);
}

async function copyEvaluatorFiles(repo: string): Promise<void> {
  for (const relative of ['src/testing/paired-theme', 'fixtures/paired-theme',
    'fixtures/evaluation', 'fixtures/profiles']) {
    await cp(path.join(SOURCE_ROOT, relative), path.join(repo, relative),
      {recursive: true, force: true});
  }
  await cp(path.join(SOURCE_ROOT, 'src/testing/artifacts.ts'),
    path.join(repo, 'src/testing/artifacts.ts'), {force: true});
  await cp(path.join(SOURCE_ROOT, 'scripts/m0-v2-evidence.ts'),
    path.join(repo, 'scripts/m0-v2-evidence.ts'), {force: true});
  await cp(path.join(SOURCE_ROOT, 'package.json'), path.join(repo, 'package.json'), {force: true});
  await cp(path.join(SOURCE_ROOT, 'pnpm-lock.yaml'), path.join(repo, 'pnpm-lock.yaml'), {force: true});
}

async function writeFakeTools(bin: string): Promise<string> {
  const pnpm = path.join(bin, 'pnpm');
  const chrome = path.join(bin, 'chrome');
  await writeFile(pnpm, `#!/bin/sh\ncase "$1" in\n--version) echo 11.14.0;;\nverify) echo verify-real-spawn;;\ne2e) echo e2e-real-spawn;;\n*) exit 64;;\nesac\n`);
  await writeFile(chrome, '#!/bin/sh\necho "Google Chrome 150.0.7871.129"\n');
  await Promise.all([chmod(pnpm, 0o755), chmod(chrome, 0o755)]);
  return chrome;
}

async function writeProbeArtifacts(root: string) {
  const source = path.join(root, 'probe.ts');
  const result = path.join(root, 'probe-result.json');
  const screenshot = path.join(root, 'quantization.png');
  await writeFile(source, '// fixed four-stage test probe\n');
  await writeFile(result, `${JSON.stringify(probeResult(), null, 2)}\n`);
  const png = new PNG({width: 220, height: 100});
  png.data.fill(255);
  paintPixel(png, 50, 50, [32, 32, 32, 255]);
  paintPixel(png, 170, 50, [41, 41, 41, 255]);
  await writeFile(screenshot, PNG.sync.write(png));
  return {source: await artifact(source), result: await artifact(result),
    screenshot: await artifact(screenshot)};
}

function probeResult() {
  return {chromeVersion: '150.0.7871.129', mapperMemory: {
    card: {r: 0.12530918065797472, g: 0.12530915853537825,
      b: 0.1253090986536019, a: 1},
    raised: {r: 0.1609007013093135, g: 0.1609006710307492,
      b: 0.16090058907227472, a: 1}, ratio: 1.120999900000913},
  cssRoundTrip: {card: 'rgb(31.95384 31.95384 31.95382)',
    raised: 'rgb(41.02968 41.02967 41.02965)', ratio: 1.1209998518368234},
  chromeComputed: {card: 'rgb(32, 32, 32)', raised: 'rgb(41, 41, 41)',
    ratio: 1.1199500334856427}, backdropComposite: {
    card: {r: 0.12549019607843137, g: 0.12549019607843137,
      b: 0.12549019607843137, a: 1},
    raised: {r: 0.1607843137254902, g: 0.1607843137254902,
      b: 0.1607843137254902, a: 1}, ratio: 1.1199500334856427},
  screenshotPixels: {card: [32, 32, 32, 255], raised: [41, 41, 41, 255]}};
}

async function artifact(file: string): Promise<M0V2ArtifactPin> {
  const bytes = await readFile(file);
  return {path: file, byteLength: bytes.byteLength, sha256: sha256(bytes)};
}
function paintPixel(png: PNG, x: number, y: number, rgba: readonly number[]): void {
  const offset = (y * png.width + x) * 4;
  rgba.forEach((value, index) => { png.data[offset + index] = value; });
}
function restoreEnv(key: 'PATH' | 'CHROME_PATH', value: string | undefined): void {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, {cwd: root})).stdout;
}
async function gitBuffer(root: string, args: string[]): Promise<Buffer> {
  return (await execFile('git', args, {cwd: root, encoding: 'buffer'})).stdout as Buffer;
}
