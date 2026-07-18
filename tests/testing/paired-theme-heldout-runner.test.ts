import {execFile as execFileCallback} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {afterEach, describe, expect, it} from 'vitest';

import {verifyFreezeBoundary} from '../../src/testing/paired-theme/heldout-runner';
import {runPairedTheme} from '../../src/testing/paired-theme/runner';

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((item) => rm(item, {
  recursive: true, force: true,
}))));

describe('held-out freeze boundary', () => {
  it('requires a clean descendant and byte-identical frozen blobs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'semantic-dark-freeze-'));
    temporaryDirectories.push(root);
    await git(root, ['init']);
    await git(root, ['config', 'user.email', 'test@example.test']);
    await git(root, ['config', 'user.name', 'Test']);
    await writeFile(path.join(root, 'metric.json'), '{"version":1}\n');
    await git(root, ['add', 'metric.json']);
    await git(root, ['commit', '-m', 'freeze']);
    const freeze = (await git(root, ['rev-parse', 'HEAD'])).trim();

    await expect(verifyFreezeBoundary(root, freeze, ['metric.json'])).resolves.toBeUndefined();
    await writeFile(path.join(root, 'metric.json'), '{"version":2}\n');
    await git(root, ['add', 'metric.json']);
    await git(root, ['commit', '-m', 'drift']);
    await expect(verifyFreezeBoundary(root, freeze, ['metric.json']))
      .rejects.toThrow(/Frozen blob differs/);
    await expect(verifyFreezeBoundary(root, 'f'.repeat(40), ['metric.json']))
      .rejects.toThrow(/not an ancestor/);
  });

  it('blocks direct held-out scoring before package exports are resolved', async () => {
    const output = path.join(homedir(), 'scratch-data',
      `semantic-dark-heldout-guard-test-${process.pid}-${Date.now()}`);
    temporaryDirectories.push(output);
    await mkdir(output, {recursive: true});
    await expect(runPairedTheme({
      protocolPath: 'fixtures/paired-theme/carbon-v1.protocol.json',
      output,
      requireClean: false,
    })).rejects.toThrow(/combined exposure claim/);
  });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFile('git', args, {cwd})).stdout;
}
