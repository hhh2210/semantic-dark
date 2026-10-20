import {execFile as execFileCallback} from 'node:child_process';
import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {
  M0_V2_ENGINE_INTERVENTION_COMMIT,
  M0_V2_MANIFEST_PATH,
  discoverM0V2PinClosure,
  m0V2ImplementationPinSetSha256,
  type M0V2Manifest,
} from '../../src/testing/paired-theme/v2/m0-manifest-contract';
import {
  assertLoadedM0V2Manifest,
  loadM0V2Manifest,
} from '../../src/testing/paired-theme/v2/m0-manifest';
import {
  makeM0V2Fixture,
  sha256,
  writeM0V2Manifest,
  type M0V2Fixture,
} from './helpers/m0-v2-fixture';

const execFile = promisify(execFileCallback);

describe.sequential('M0-v2 manifest provenance', () => {
  let fixture: M0V2Fixture;

  beforeAll(async () => { fixture = await makeM0V2Fixture(); }, 60_000);
  afterAll(async () => {
    if (fixture) await rm(fixture.root, {recursive: true, force: true});
  });

  it('authenticates v1 values, E-to-F closure, real completions, and A3 artifacts', async () => {
    const loaded = await loadM0V2Manifest(options(fixture));
    expect(loaded.provenance.manifest.sha256).toBe(fixture.expectedSha256);
    expect(loaded.provenance.predecessor.profile).toEqual({
      manifestSha256: '69efa054f742c58b7c69e6d64bca51e04e67ef730ac67ac980a3ddff854bb205',
      declaredCanonicalSha256: 'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5',
      computedCanonicalSha256: 'e6fd84a659b23272bfac8049abf7f5711b96abff793029340fdc942313fe6cb5',
    });
    expect(loaded.provenance.evidence.verify.completion.argv[1]).toBe('verify');
    expect(loaded.provenance.evidence.e2e.completion.argv[1]).toBe('e2e');
    expect(loaded.provenance.evidence.verify.completion.outcome).toEqual({
      exitCode: 0, signal: null, status: 'passed',
    });
    expect(loaded.provenance.a3.viewport).toEqual({
      width: 220, height: 100, deviceScaleFactor: 1,
    });
    expect(() => assertLoadedM0V2Manifest(loaded)).not.toThrow();
    expect(() => assertLoadedM0V2Manifest(structuredClone(loaded))).toThrow(/externally pinned/);
  }, 60_000);

  it('derives a closed engine and evaluator file inventory from the two commits', async () => {
    const closure = await discoverM0V2PinClosure(fixture.repo, fixture.evaluatorCommit);
    const byPath = new Map(closure.map((entry) => [entry.path, entry.commitRole]));
    const engineTree = await treeFiles(fixture.repo, M0_V2_ENGINE_INTERVENTION_COMMIT);
    const production = engineTree.filter((file) =>
      file.startsWith('src/') && !file.startsWith('src/testing/'));
    expect(production.length).toBeGreaterThan(20);
    expect(production.every((file) => byPath.get(file) === 'engine')).toBe(true);
    const evaluatorTree = await treeFiles(fixture.repo, fixture.evaluatorCommit);
    const pairedTheme = evaluatorTree.filter((file) =>
      file.startsWith('src/testing/paired-theme/'));
    expect(pairedTheme.length).toBeGreaterThan(30);
    expect(pairedTheme.every((file) => byPath.get(file) === 'evaluator')).toBe(true);
    for (const file of ['scripts/build.mjs', 'scripts/e2e.mjs',
      'src/testing/e2e/chrome-session.mjs', 'fixtures/integration/index.html',
      'extension/manifest.json', 'package.json', 'pnpm-lock.yaml']) {
      expect(byPath.has(file), file).toBe(true);
    }
  });

  it('rejects changed manifest bytes under the old external digest', async () => {
    const changed = clone(fixture.manifest);
    changed.recordedAt = new Date(new Date(changed.recordedAt).valueOf() + 1).toISOString();
    await writeM0V2Manifest(fixture.repo, changed);
    await expect(loadM0V2Manifest(options(fixture))).rejects.toThrow(/manifest SHA-256 mismatch/);
    await restoreManifest(fixture);
  });

  it('rejects non-canonical timestamps in both schema and runtime paths', async () => {
    const changed = clone(fixture.manifest);
    changed.recordedAt = '2026-07-19T00:00:00Z';
    const expectedSha256 = await writeM0V2Manifest(fixture.repo, changed);
    await expect(loadM0V2Manifest({...options(fixture), expectedSha256}))
      .rejects.toThrow(/JSON Schema|recordedAt/);
    await restoreManifest(fixture);
  });

  it('rejects an incomplete closure and a forged evaluator tree', async () => {
    const incomplete = clone(fixture.manifest);
    incomplete.implementationPins.files = incomplete.implementationPins.files.slice(1);
    incomplete.implementationPins.pinSetSha256 = m0V2ImplementationPinSetSha256(
      incomplete.implementationPins.files, incomplete.implementationPins.evaluatorTreeSha1);
    let expectedSha256 = await writeM0V2Manifest(fixture.repo, incomplete);
    await expect(loadM0V2Manifest({...options(fixture), expectedSha256}))
      .rejects.toThrow(/exact .*file closure/);

    const forged = clone(fixture.manifest);
    forged.implementationPins.evaluatorTreeSha1 = '0'.repeat(40);
    forged.implementationPins.pinSetSha256 = m0V2ImplementationPinSetSha256(
      forged.implementationPins.files, forged.implementationPins.evaluatorTreeSha1);
    expectedSha256 = await writeM0V2Manifest(fixture.repo, forged);
    await expect(loadM0V2Manifest({...options(fixture), expectedSha256}))
      .rejects.toThrow(/evaluator tree SHA-1 mismatch/);
    await restoreManifest(fixture);
  });

  it('rejects current engine or evaluator byte drift from the committed snapshots', async () => {
    for (const role of ['engine', 'evaluator'] as const) {
      const target = fixture.manifest.implementationPins.files.find((pin) =>
        pin.commitRole === role)!;
      const targetPath = path.join(fixture.repo, target.path);
      const original = await readFile(targetPath);
      await writeFile(targetPath, Buffer.concat([original, Buffer.from('\n// drift\n')]));
      await expect(loadM0V2Manifest(options(fixture)))
        .rejects.toThrow(new RegExp(`implementation pin ${escapeRegex(target.path)} SHA-256 mismatch`));
      await writeFile(targetPath, original);
    }
  }, 60_000);

  it('does not accept a passed-looking log without a runner completion', async () => {
    const changed = clone(fixture.manifest);
    const completionPath = changed.evidence.verify.completion.path;
    const original = await readFile(completionPath);
    const fake = Buffer.from('{"command":"pnpm verify","status":"passed","exitCode":0}\n');
    await writeFile(completionPath, fake);
    changed.evidence.verify.completion = {path: completionPath,
      byteLength: fake.byteLength, sha256: sha256(fake)};
    const expectedSha256 = await writeM0V2Manifest(fixture.repo, changed);
    await expect(loadM0V2Manifest({...options(fixture), expectedSha256}))
      .rejects.toThrow(/completion violates JSON Schema/);
    await writeFile(completionPath, original);
    await restoreManifest(fixture);
  }, 60_000);

  it('rejects log tampering even though the completion remains immutable', async () => {
    const loaded = await loadM0V2Manifest(options(fixture));
    const logPath = loaded.provenance.evidence.verify.logPath;
    const original = await readFile(logPath);
    await writeFile(logPath, Buffer.concat([original, Buffer.from('tampered\n')]));
    await expect(loadM0V2Manifest(options(fixture))).rejects.toThrow(/log bytes/);
    await writeFile(logPath, original);
  }, 60_000);

  it('rejects semantically changed A3 results even when every outer pin is refreshed', async () => {
    const changed = clone(fixture.manifest);
    const resultPath = changed.a3.artifacts.result.path;
    const original = await readFile(resultPath);
    const result = JSON.parse(original.toString('utf8')) as Record<string, any>;
    result.chromeComputed.ratio += 0.001;
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    await writeFile(resultPath, bytes);
    changed.a3.artifacts.result = {path: resultPath, byteLength: bytes.byteLength,
      sha256: sha256(bytes)};
    const expectedSha256 = await writeM0V2Manifest(fixture.repo, changed);
    await expect(loadM0V2Manifest({...options(fixture), expectedSha256}))
      .rejects.toThrow(/chromeComputed\.ratio/);
    await writeFile(resultPath, original);
    await restoreManifest(fixture);
  }, 60_000);
});

function options(fixture: M0V2Fixture) {
  return {repoRoot: fixture.repo, manifestPath: M0_V2_MANIFEST_PATH,
    expectedSha256: fixture.expectedSha256, evidenceRoot: fixture.logs,
    a3EvidenceRoot: fixture.probe};
}
async function restoreManifest(fixture: M0V2Fixture) {
  fixture.expectedSha256 = await writeM0V2Manifest(fixture.repo, fixture.manifest);
}
function clone(value: M0V2Manifest): M0V2Manifest { return structuredClone(value); }
async function treeFiles(root: string, commit: string): Promise<string[]> {
  const stdout = (await execFile('git', ['ls-tree', '-r', '--name-only', commit], {cwd: root})).stdout;
  return stdout.split('\n').filter(Boolean);
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
