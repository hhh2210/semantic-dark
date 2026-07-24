import {readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {NORMALIZED_TOKEN_NAMES, type PackagePin} from '../../src/testing/paired-theme/types';
import {
  assertLoadedV2RegisteredProtocol,
  loadV2RegisteredProtocol,
  type V2RegisteredProtocol,
} from '../../src/testing/paired-theme/v2/protocol';
import {validateV2ProtocolSourceConfig} from '../../src/testing/paired-theme/v2/protocol-source-config';
import {verifyV2PackageLock} from '../../src/testing/paired-theme/v2/package-lock';
import type {ValidatedV2EvaluationContract} from '../../src/testing/paired-theme/v2/contract';
import type {V2ExportedThemeSelectors} from '../../src/testing/paired-theme/v2/exported-theme-source';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  sha256,
  type V2SpecFixture,
} from './helpers/v2-spec-fixture';

const roots: string[] = [];
const COMMON_SCENES = path.resolve('fixtures/paired-theme/common-scenes.v1.json');
const PACKAGE = {
  name: '@semantic-dark/definitely-not-installed', version: '1.2.3',
  integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
  license: 'MIT', repository: 'https://example.com/theme',
};

afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, {recursive: true, force: true}))));

describe('paired-theme v2 registered protocol loader', () => {
  it('loads only the registry-pinned protocol and common scenes without package access', async () => {
    const fixture = await setup();
    const loaded = await loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root);

    expect(loaded.protocol).toMatchObject({
      id: 'material', split: 'development', adapterId: 'material-adapter',
      colorProfile: 'srgb', limits: {maxScenes: 24, maxReviewedDecisions: 10},
    });
    expect(loaded.metricSpecSha256).toBe(fixture.contract.metricSpecSha256);
    expect(loaded.sourceConfig).toMatchObject({kind: 'exported-theme-object', package: PACKAGE});
    expect(loaded.scenes.scenes).toHaveLength(4);
    expect(loaded.scenes.scenes.flatMap((scene) => scene.paints)).toHaveLength(15);
    expect(loaded.scenes.scenes.flatMap((scene) => scene.paints)
      .filter((paint) => paint.reviewed)).toHaveLength(10);
    const canonicalRoot = await realpath(fixture.spec.root);
    expect(loaded.protocolPath).toBe(path.join(canonicalRoot, 'fixtures/protocols/material.json'));
    expect(loaded.sceneManifestPath).toBe(path.join(canonicalRoot, 'fixtures/scenes.json'));
    expect(loaded.packageLockPath).toBe(path.join(canonicalRoot, 'pnpm-lock.yaml'));
    expect(loaded.packageLockSha256).toBe(sha256(await readFile(loaded.packageLockPath)));
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.sourceConfig)).toBe(true);
    expect(Object.isFrozen(loaded.scenes.scenes[0]!.paints[0])).toBe(true);
  });

  it('rechecks protocol and scene bytes after the branded contract was loaded', async () => {
    const protocolDrift = await setup();
    await writeFile(protocolDrift.protocolPath, '{}\n');
    await expect(loadV2RegisteredProtocol(
      protocolDrift.contract, 'material', protocolDrift.spec.root,
    )).rejects.toThrow(/material protocol SHA-256 mismatch/);

    const sceneDrift = await setup();
    await writeFile(sceneDrift.scenePath, '{}\n');
    await expect(loadV2RegisteredProtocol(
      sceneDrift.contract, 'material', sceneDrift.spec.root,
    )).rejects.toThrow(/material scene manifest SHA-256 mismatch/);
  });

  it('binds every declared package integrity to the repository lockfile', async () => {
    const fixture = await setup();
    await writeFile(fixture.lockPath, packageLock([{...PACKAGE, integrity: 'sha512-QUJDRA=='}]));
    await expect(loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root))
      .rejects.toThrow(/invalid SHA-512 integrity/);
  });

  it('rejects duplicate lockfile sections and duplicate integrity keys', async () => {
    const duplicateSection = await setup();
    await writeFile(duplicateSection.lockPath,
      `${packageLock([PACKAGE])}\npackages:\n  duplicate@1.0.0: {}\n`);
    await expect(loadV2RegisteredProtocol(
      duplicateSection.contract, 'material', duplicateSection.spec.root,
    )).rejects.toThrow(/invalid YAML/);

    const duplicateIntegrity = await setup();
    const ambiguous = packageLock([PACKAGE]).replace(
      `integrity: ${PACKAGE.integrity}`,
      `integrity: ${PACKAGE.integrity}, integrity: ${PACKAGE.integrity}`,
    );
    await writeFile(duplicateIntegrity.lockPath, ambiguous);
    await expect(loadV2RegisteredProtocol(
      duplicateIntegrity.contract, 'material', duplicateIntegrity.spec.root,
    )).rejects.toThrow(/invalid YAML/);
  });

  it('matches every committed development package pin against the real lockfile', async () => {
    const pins: PackagePin[] = [];
    for (const system of ['material', 'primer', 'spectrum', 'carbon', 'fluent']) {
      const protocol = JSON.parse(await readFile(
        path.resolve(`fixtures/paired-theme/v2/${system}.protocol.json`), 'utf8',
      )) as Record<string, any>;
      pins.push(protocol.source.package);
      if (protocol.source.schemaPackage) pins.push(protocol.source.schemaPackage);
    }
    const verified = await verifyV2PackageLock(process.cwd(), pins);
    expect(verified.packages).toHaveLength(6);
    expect(verified.sha256).toBe(sha256(await readFile('pnpm-lock.yaml')));
  });

  it.each([
    ['identity', (protocol: Record<string, any>) => { protocol.id = 'primer'; }],
    ['split', (protocol: Record<string, any>) => { protocol.split = 'held-out'; }],
    ['adapter', (protocol: Record<string, any>) => { protocol.adapterId = 'other-adapter'; }],
    ['extra field', (protocol: Record<string, any>) => { protocol.sceneManifest = 'override.json'; }],
  ])('rejects protocol %s drift even when those bytes are newly pinned', async (_label, mutate) => {
    const fixture = await setup({protocolMutation: mutate});
    await expect(loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root))
      .rejects.toThrow(/identity\/split\/adapter mismatch|unexpected shape/);
  });

  it('rejects unknown systems, forged contracts, and divergent scene pins', async () => {
    const fixture = await setup();
    await expect(loadV2RegisteredProtocol(fixture.contract, 'unknown', fixture.spec.root))
      .rejects.toThrow(/absent from the frozen v2 registry/);
    await expect(loadV2RegisteredProtocol({} as ValidatedV2EvaluationContract,
      'material', fixture.spec.root)).rejects.toThrow(/loaded from pinned metric-spec bytes/);
    expect(() => assertLoadedV2RegisteredProtocol({} as never))
      .toThrow(/protocol loaded from pinned registry bytes/);

    await expect(setup({divergentScenePin: true}))
      .rejects.toThrow(/records scene manifest must match every registered system/);
  });

  it.each([
    ['scene count', (manifest: Record<string, any>) => { manifest.scenes.pop(); }],
    ['paint count', (manifest: Record<string, any>) => {
      const extra = structuredClone(manifest.scenes[2].paints[3]);
      extra.id = 'form.extra'; extra.reviewed = false;
      manifest.scenes[2].paints.push(extra);
    }],
    ['reviewed count', (manifest: Record<string, any>) => {
      manifest.scenes[0].paints[0].reviewed = false;
    }],
  ])('rejects a common manifest with the wrong exact %s', async (_label, mutate) => {
    const fixture = await setup({sceneMutation: mutate});
    await expect(loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root))
      .rejects.toThrow(/exactly 4 scenes, 15 paints, and 10 reviewed decisions/);
  });

  it.each(['maxScenes', 'maxReviewedDecisions'] as const)(
    'enforces the 24-item protocol ceiling for %s', async (key) => {
      const fixture = await setup({protocolMutation: (protocol) => { protocol.limits[key] = 25; }});
      await expect(loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root))
        .rejects.toThrow(/integer in \[1, 24\]/);
    },
  );

  it('rejects token-value fields and unsafe or incomplete exported selector paths', async () => {
    const leaked = await setup({protocolMutation: (protocol) => {
      protocol.source.tokenValues = {canvas: '#fff'};
    }});
    await expect(loadV2RegisteredProtocol(leaked.contract, 'material', leaked.spec.root))
      .rejects.toThrow(/unexpected shape/);

    const unsafe = await setup({protocolMutation: (protocol) => {
      protocol.source.selectors.canvas.light = ['__proto__'];
    }});
    await expect(loadV2RegisteredProtocol(unsafe.contract, 'material', unsafe.spec.root))
      .rejects.toThrow(/safe non-empty export path/);

    const incomplete = await setup({protocolMutation: (protocol) => {
      delete protocol.source.selectors.canvas;
    }});
    await expect(loadV2RegisteredProtocol(incomplete.contract, 'material', incomplete.spec.root))
      .rejects.toThrow(/selectors has an unexpected shape/);
  });

  it('validates the other adapter-specific JSON configurations without reading their files', () => {
    expect(validateV2ProtocolSourceConfig({kind: 'generated-scheme', package: PACKAGE,
      generator: {seed: '#6750a4', variant: 'tonal-spot', specVersion: '2021',
        platform: 'phone', contrastLevel: 0}}).kind).toBe('generated-scheme');
    expect(validateV2ProtocolSourceConfig({kind: 'static-token-json', package: PACKAGE,
      lightPath: 'dist/light.json', darkPath: 'dist/dark.json'}).kind).toBe('static-token-json');
    expect(validateV2ProtocolSourceConfig({kind: 'cascade-token-json', package: PACKAGE,
      schemaPackage: {...PACKAGE, name: '@semantic-dark/schema'},
      tokenPaths: ['tokens/colors.json'], modeSetPath: 'modes/color.json',
      modes: {light: 'light', dark: 'dark'}, schema: {specVersion: '1',
        tokenSchemaId: 'https://example.com/token.schema.json',
        modeSetSchemaId: 'https://example.com/mode.schema.json'}}).kind).toBe('cascade-token-json');
  });

  it('rejects a post-contract symlink escape before reading either registered file', async () => {
    const fixture = await setup();
    const outside = path.join(fixture.spec.root, '..', `${path.basename(fixture.spec.root)}-outside.json`);
    roots.push(outside);
    await writeFile(outside, '{}\n');
    await rm(fixture.protocolPath);
    await symlink(outside, fixture.protocolPath);
    await expect(loadV2RegisteredProtocol(fixture.contract, 'material', fixture.spec.root))
      .rejects.toThrow(/path escapes repository root/);
  });
});

interface SetupOptions {
  protocolMutation?: (protocol: Record<string, any>) => void;
  sceneMutation?: (manifest: Record<string, any>) => void;
  divergentScenePin?: boolean;
}

async function setup(options: SetupOptions = {}): Promise<{
  spec: V2SpecFixture;
  contract: ValidatedV2EvaluationContract;
  protocolPath: string;
  scenePath: string;
  lockPath: string;
}> {
  const spec = await makeV2SpecFixture();
  roots.push(spec.root);
  const document = structuredClone(spec.document) as Record<string, any>;
  const manifest = JSON.parse(await readFile(COMMON_SCENES, 'utf8')) as Record<string, any>;
  options.sceneMutation?.(manifest);
  const sceneBytes = `${JSON.stringify(manifest)}\n`;
  const scenePath = path.join(spec.root, 'fixtures/scenes.json');
  await writeFile(scenePath, sceneBytes);
  for (const system of document.registry.systems) system.sceneManifestSha256 = sha256(sceneBytes);
  document.records.sceneManifestSha256 = sha256(sceneBytes);

  const protocol = baseProtocol();
  options.protocolMutation?.(protocol);
  const protocolBytes = `${JSON.stringify(protocol)}\n`;
  const protocolPath = path.join(spec.root, 'fixtures/protocols/material.json');
  await writeFile(protocolPath, protocolBytes);
  const lockPath = path.join(spec.root, 'pnpm-lock.yaml');
  await writeFile(lockPath, packageLock([PACKAGE]));
  document.registry.systems[0].protocolSha256 = sha256(protocolBytes);
  if (options.divergentScenePin) {
    const alternatePath = path.join(spec.root, 'fixtures/scenes-alternate.json');
    await writeFile(alternatePath, sceneBytes);
    document.registry.systems.at(-1).sceneManifestPath = 'fixtures/scenes-alternate.json';
  }
  const contract = await loadChangedV2Spec(spec, document);
  return {spec, contract, protocolPath, scenePath, lockPath};
}

function packageLock(pins: readonly {name: string; version: string; integrity: string}[]): string {
  const entries = pins.map((pin) =>
    `  '${pin.name}@${pin.version}':\n    resolution: {integrity: ${pin.integrity}}`).join('\n\n');
  return `lockfileVersion: '9.0'\n\npackages:\n\n${entries}\n\nsnapshots:\n`;
}

function baseProtocol(): Record<string, any> {
  const selectors = Object.fromEntries(NORMALIZED_TOKEN_NAMES.map((name) => [name, {
    light: ['lightTheme', name], dark: ['darkTheme', name],
  }])) as unknown as V2ExportedThemeSelectors;
  return {
    schema: 'semantic-dark.paired-theme-protocol.v2', id: 'material', split: 'development',
    adapterId: 'material-adapter', source: {kind: 'exported-theme-object', package: PACKAGE, selectors},
    viewport: {width: 1280, height: 900, deviceScaleFactor: 1}, locale: 'en-US',
    colorProfile: 'srgb', limits: {maxScenes: 24, maxReviewedDecisions: 10},
  } satisfies V2RegisteredProtocol;
}
