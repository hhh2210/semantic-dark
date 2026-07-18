import {
  Hct,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';
import {serializeCanonicalJson, sha256Text} from '../artifacts';
import type {
  MaterialGeneratorConfig,
  MaterialProtocolSource,
  NormalizedThemePair,
  NormalizedTokenName,
} from './types';

type MaterialScheme = InstanceType<typeof SchemeTonalSpot>;

const MATERIAL_TOKEN_READERS: Readonly<Record<NormalizedTokenName, {
  sourceToken: string;
  read: (scheme: MaterialScheme) => number;
}>> = {
  canvas: {sourceToken: 'background', read: (scheme) => scheme.background},
  surface: {sourceToken: 'surface', read: (scheme) => scheme.surface},
  surfaceRaised: {
    sourceToken: 'surfaceContainerHigh',
    read: (scheme) => scheme.surfaceContainerHigh,
  },
  textPrimary: {sourceToken: 'onSurface', read: (scheme) => scheme.onSurface},
  textSecondary: {
    sourceToken: 'onSurfaceVariant',
    read: (scheme) => scheme.onSurfaceVariant,
  },
  tableHeader: {
    sourceToken: 'surfaceContainerLow',
    read: (scheme) => scheme.surfaceContainerLow,
  },
  selectedSurface: {
    sourceToken: 'primaryContainer',
    read: (scheme) => scheme.primaryContainer,
  },
  border: {sourceToken: 'outline', read: (scheme) => scheme.outline},
  focus: {sourceToken: 'primary', read: (scheme) => scheme.primary},
  dangerSurface: {
    sourceToken: 'errorContainer',
    read: (scheme) => scheme.errorContainer,
  },
  dangerText: {
    sourceToken: 'onErrorContainer',
    read: (scheme) => scheme.onErrorContainer,
  },
};

export function materialThemePair(source: MaterialProtocolSource): NormalizedThemePair {
  assertMaterialSource(source);
  const light = createScheme(source.generator, false);
  const dark = createScheme(source.generator, true);
  const tokens = Object.fromEntries(
    Object.entries(MATERIAL_TOKEN_READERS).map(([name, descriptor]) => [name, {
      name,
      light: hexFromArgb(descriptor.read(light)),
      dark: hexFromArgb(descriptor.read(dark)),
      sourceToken: descriptor.sourceToken,
      provenance: 'generator-derived',
    }]),
  ) as NormalizedThemePair['tokens'];
  return {
    system: 'material',
    split: 'development',
    source: source.package,
    generatorConfig: source.generator,
    tokens,
  };
}

export function normalizedTokenHash(theme: NormalizedThemePair): string {
  return sha256Text(serializeCanonicalJson(theme.tokens));
}

function createScheme(config: MaterialGeneratorConfig, isDark: boolean): MaterialScheme {
  return new SchemeTonalSpot(
    Hct.fromInt(argbFromHex(config.seed)),
    isDark,
    config.contrastLevel,
    config.specVersion,
    config.platform,
  );
}

function assertMaterialSource(source: MaterialProtocolSource): void {
  if (source.package.name !== '@material/material-color-utilities' ||
      source.package.version !== '0.4.0' ||
      source.package.license !== 'Apache-2.0') {
    throw new Error('Material source must use the audited 0.4.0 Apache-2.0 package pin');
  }
  if (source.generator.variant !== 'tonal-spot' ||
      source.generator.specVersion !== '2021' ||
      source.generator.platform !== 'phone' ||
      source.generator.contrastLevel !== 0) {
    throw new Error('Material generator configuration differs from the frozen M1a contract');
  }
  if (!/^#[0-9a-f]{6}$/i.test(source.generator.seed)) {
    throw new Error(`Invalid Material seed: ${source.generator.seed}`);
  }
}
