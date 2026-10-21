// @vitest-environment node
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {assertE2eInputs, createFixtureServer} from '../../src/testing/e2e/server.mjs';

let directory;
afterEach(async () => { if (directory) await rm(directory, {recursive: true, force: true}); });

describe('fixture route inputs', () => {
  it('validates and serves mixed static/callback routes', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'semantic-dark-routes-'));
    await writeFile(path.join(directory, 'manifest.json'), '{}');
    await writeFile(path.join(directory, 'fixture.html'), 'static fixture');
    const routes = new Map([
      ['/', ['fixture.html', 'text/html']],
      ['/dynamic', (_request, response) => response.end('callback fixture')],
    ]);
    const config = {chromePath: process.execPath, extensionDir: directory, fixtureDir: directory, routes};
    await expect(assertE2eInputs(config)).resolves.toBeUndefined();
    const fixture = await createFixtureServer(config);
    try {
      expect(await (await fetch(fixture.url)).text()).toBe('static fixture');
      expect(await (await fetch(new URL('/dynamic', fixture.url))).text()).toBe('callback fixture');
    } finally { await fixture.close(); }
    routes.set('/missing', ['missing.css', 'text/css']);
    await expect(assertE2eInputs(config)).rejects.toThrow('ENOENT');
  });
});
