import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {
  loadV2ExportedThemePair,
} from '../../src/testing/paired-theme/v2/exported-theme-source';
import {
  loadV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from '../../src/testing/paired-theme/v2/protocol';
import {NORMALIZED_TOKEN_NAMES} from '../../src/testing/paired-theme/types';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  sha256,
} from './helpers/v2-spec-fixture';

const roots: string[] = [];
const COMMON_SCENES = path.resolve('fixtures/paired-theme/common-scenes.v1.json');

afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, {recursive: true, force: true}))));

describe('v2 exported-theme development adapter', () => {
  it('resolves Carbon component-token maps through the pinned protocol', async () => {
    const {loaded} = await setup('carbon');
    const theme = loadV2ExportedThemePair(loaded);
    expect(theme.split).toBe('development');
    expect(theme.tokens.canvas).toMatchObject({light: '#ffffff', dark: '#161616'});
    expect(theme.tokens.dangerSurface).toMatchObject({light: '#fff1f1', dark: '#262626'});
    expect(theme.tokens.dangerSurface.sourceToken).toContain('notificationBackgroundError');
  });

  it('loads the complete Fluent authored light/dark pair through the same adapter', async () => {
    const {loaded} = await setup('fluent');
    const theme = loadV2ExportedThemePair(loaded);
    expect(Object.keys(theme.tokens).sort()).toEqual([...NORMALIZED_TOKEN_NAMES].sort());
    expect(theme.tokens.canvas).toMatchObject({light: '#ffffff', dark: '#292929'});
    expect(theme.tokens.focus).toMatchObject({light: '#000000', dark: '#ffffff'});
    expect(theme.tokens.dangerSurface).toMatchObject({light: '#fdf6f6', dark: '#3f1011'});
  });

  it('rejects forged protocols before any package access', () => {
    expect(() => loadV2ExportedThemePair({} as never))
      .toThrow(/protocol loaded from pinned registry bytes/);
  });

  it('freezes resolved values and rejects lockfile drift before package execution', async () => {
    const {loaded, lockPath} = await setup('carbon');
    const theme = loadV2ExportedThemePair(loaded);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.tokens.canvas)).toBe(true);
    expect(Object.isFrozen(theme.tokens.canvas.resolutionPath!.light)).toBe(true);
    expect(() => {
      (theme.tokens.canvas as {light: string}).light = '#123456';
    }).toThrow(TypeError);

    await writeFile(lockPath, `${await readFile(lockPath, 'utf8')}# drift\n`);
    expect(() => loadV2ExportedThemePair(loaded)).toThrow(/lockfile changed/);
  });
});

async function setup(system: 'carbon' | 'fluent'): Promise<{
  loaded: LoadedV2RegisteredProtocol;
  lockPath: string;
}> {
  const spec = await makeV2SpecFixture();
  roots.push(spec.root);
  const document = structuredClone(spec.document) as Record<string, any>;
  const sceneBytes = await readFile(COMMON_SCENES);
  await writeFile(path.join(spec.root, 'fixtures/scenes.json'), sceneBytes);
  for (const entry of document.registry.systems) entry.sceneManifestSha256 = sha256(sceneBytes);

  const protocol = JSON.parse(await readFile(
    path.resolve(`fixtures/paired-theme/v2/${system}.protocol.json`), 'utf8',
  )) as Record<string, any>;
  const protocolBytes = `${JSON.stringify(protocol)}\n`;
  const entry = document.registry.systems.find((item: Record<string, unknown>) => item.id === system);
  entry.adapterId = protocol.adapterId;
  entry.protocolSha256 = sha256(protocolBytes);
  await writeFile(path.join(spec.root, entry.protocolPath), protocolBytes);

  const pins = [protocol.source.package];
  if (protocol.source.schemaPackage) pins.push(protocol.source.schemaPackage);
  const lockPath = path.join(spec.root, 'pnpm-lock.yaml');
  await writeFile(lockPath, packageLock(pins));
  const contract = await loadChangedV2Spec(spec, document);
  return {loaded: await loadV2RegisteredProtocol(contract, system, spec.root), lockPath};
}

function packageLock(pins: readonly {name: string; version: string; integrity: string}[]): string {
  const entries = pins.map((pin) =>
    `  '${pin.name}@${pin.version}':\n    resolution: {integrity: ${pin.integrity}}`).join('\n\n');
  return `lockfileVersion: '9.0'\n\npackages:\n\n${entries}\n\nsnapshots:\n`;
}
