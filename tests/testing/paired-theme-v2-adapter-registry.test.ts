import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {NORMALIZED_TOKEN_NAMES, type NormalizedTokenName} from '../../src/testing/paired-theme/types';
import {
  V2_ADAPTER_IDS,
  resolveV2DevelopmentSource,
} from '../../src/testing/paired-theme/v2/adapter-registry';
import type {V2ExportedThemeSelectors} from '../../src/testing/paired-theme/v2/exported-theme-source';
import {loadV2RegisteredProtocol} from '../../src/testing/paired-theme/v2/protocol';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  sha256,
} from './helpers/v2-spec-fixture';

const roots: string[] = [];
const COMMON_SCENES = path.resolve('fixtures/paired-theme/common-scenes.v1.json');
const CARBON_PACKAGE = {
  name: '@carbon/themes', version: '11.77.0',
  integrity: 'sha512-5MGfcWiKwpIAmmtq4zlAeSkGkECaVXhr61Ol0EUFQskUlhAgeKhlIc5iWXFmwDb25oxzEFo0puH+GKsLL4GN/w==',
  license: 'Apache-2.0', repository: 'https://github.com/carbon-design-system/carbon',
} as const;

afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, {recursive: true, force: true}))));

describe('v2 adapter registry', () => {
  it('dispatches Material and Carbon development sources only through frozen adapter IDs', async () => {
    const material = await setup('material', V2_ADAPTER_IDS.material, {
      kind: 'generated-scheme',
      package: {
        name: '@material/material-color-utilities', version: '0.4.0',
        integrity: 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==',
        license: 'Apache-2.0', repository: 'https://github.com/material-foundation/material-color-utilities',
      },
      generator: {seed: '#6750a4', variant: 'tonal-spot', specVersion: '2021',
        platform: 'phone', contrastLevel: 0},
    });
    const materialResolved = await resolveV2DevelopmentSource(material.contract, material.loaded);
    expect(materialResolved.theme.system).toBe('material');
    expect(materialResolved.normalizedTokensSha256).toMatch(/^[0-9a-f]{64}$/);

    const carbon = await setup('carbon', V2_ADAPTER_IDS.exportedObject, {
      kind: 'exported-theme-object', package: CARBON_PACKAGE, selectors: carbonSelectors(),
    });
    const carbonResolved = await resolveV2DevelopmentSource(carbon.contract, carbon.loaded);
    expect(carbonResolved.theme.tokens.dangerSurface)
      .toMatchObject({light: '#fff1f1', dark: '#262626'});
  });

  it('refuses registry entries that are not development systems', async () => {
    const value = await setup('holdout-one', V2_ADAPTER_IDS.exportedObject, {
      kind: 'exported-theme-object', package: CARBON_PACKAGE, selectors: carbonSelectors(),
    });
    await expect(resolveV2DevelopmentSource(value.contract, value.loaded))
      .rejects.toThrow(/holdout-one is not a development system/);
  });

  it('rejects adapter/source-kind mismatch without fallback dispatch', async () => {
    const value = await setup('material', V2_ADAPTER_IDS.primer, {
      kind: 'generated-scheme', package: CARBON_PACKAGE,
      generator: {seed: '#6750a4', variant: 'tonal-spot', specVersion: '2021',
        platform: 'phone', contrastLevel: 0},
    });
    await expect(resolveV2DevelopmentSource(value.contract, value.loaded))
      .rejects.toThrow(/rejects source kind generated-scheme/);
  });
});

async function setup(systemId: string, adapterId: string, source: unknown) {
  const spec = await makeV2SpecFixture();
  roots.push(spec.root);
  const document = structuredClone(spec.document);
  const sceneBytes = await readFile(COMMON_SCENES);
  await writeFile(path.join(spec.root, 'fixtures/scenes.json'), sceneBytes);
  for (const entry of document.registry.systems) entry.sceneManifestSha256 = sha256(sceneBytes);
  document.records.sceneManifestSha256 = sha256(sceneBytes);
  const entry = document.registry.systems.find((item: any) => item.id === systemId)!;
  entry.adapterId = adapterId;
  const protocol = {
    schema: 'semantic-dark.paired-theme-protocol.v2', id: systemId,
    split: entry.split, adapterId, source,
    viewport: {width: 1440, height: 900, deviceScaleFactor: 1},
    locale: 'en-US', colorProfile: 'srgb',
    limits: {maxScenes: 24, maxReviewedDecisions: 10},
  };
  const protocolBytes = `${JSON.stringify(protocol)}\n`;
  await writeFile(path.join(spec.root, entry.protocolPath), protocolBytes);
  const sourceValue = source as {package: typeof CARBON_PACKAGE; schemaPackage?: typeof CARBON_PACKAGE};
  const pins = [sourceValue.package, ...(sourceValue.schemaPackage ? [sourceValue.schemaPackage] : [])];
  await writeFile(path.join(spec.root, 'pnpm-lock.yaml'), packageLock(pins));
  entry.protocolSha256 = sha256(protocolBytes);
  const contract = await loadChangedV2Spec(spec, document);
  const loaded = await loadV2RegisteredProtocol(contract, systemId, spec.root);
  return {spec, contract, loaded};
}

function packageLock(pins: readonly {name: string; version: string; integrity: string}[]): string {
  const entries = pins.map((pin) =>
    `  '${pin.name}@${pin.version}':\n    resolution: {integrity: ${pin.integrity}}`).join('\n\n');
  return `lockfileVersion: '9.0'\n\npackages:\n\n${entries}\n\nsnapshots:\n`;
}

function carbonSelectors(): V2ExportedThemeSelectors {
  const keys: Readonly<Record<NormalizedTokenName, string>> = {
    canvas: 'background', surface: 'layer01', surfaceRaised: 'layer02',
    textPrimary: 'textPrimary', textSecondary: 'textSecondary', tableHeader: 'layerAccent01',
    selectedSurface: 'layerSelected01', border: 'borderSubtle01', focus: 'focus',
    dangerSurface: 'notificationBackgroundError', dangerText: 'textPrimary',
  };
  return Object.fromEntries(NORMALIZED_TOKEN_NAMES.map((name) => {
    if (name === 'dangerSurface') return [name, {
      light: ['notificationTokens', 'notificationTokens', 'notificationBackgroundError', 'whiteTheme'],
      dark: ['notificationTokens', 'notificationTokens', 'notificationBackgroundError', 'g100'],
    }];
    return [name, {light: ['white', keys[name]], dark: ['g100', keys[name]]}];
  })) as unknown as V2ExportedThemeSelectors;
}
