import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {formatCssColor, parseCssColor} from '../../color';
import {validateProtocolSource} from './protocol-source';
import {
  createSpectrumColorResolver,
  type SpectrumColorResolution,
  type SpectrumTokenDocument,
} from './spectrum-resolver';
import type {
  NormalizedThemePair,
  NormalizedTokenName,
  PackagePin,
  SpectrumProtocolSource,
} from './types';

const require = createRequire(import.meta.url);
const SELECTED_OPACITY_UUID = '61b3aa04-0e7e-44b8-a4c8-8442a4ebf549';

interface SpectrumDescriptor {
  sourceToken: string;
  reference: string;
}

const SPECTRUM_TOKENS: Readonly<Record<NormalizedTokenName, SpectrumDescriptor>> = {
  canvas: descriptor('background-base-color', 'e0d8739d-18dd-44bc-92ea-e443882a780b'),
  surface: descriptor('background-layer-1-color', '7e6678b7-2903-434b-8ee2-06c83815b01d'),
  surfaceRaised: descriptor('background-elevated-color', '68fc2ac3-45b4-4067-a238-45a930ae9485'),
  textPrimary: descriptor('neutral-content-color-default', '43ca4c0d-7803-4e8e-b444-26fe70d5304c'),
  textSecondary: descriptor('neutral-subdued-content-color-default', '7a058b23-341c-4dd3-83d8-358917277836'),
  tableHeader: descriptor('background-base-color', 'e0d8739d-18dd-44bc-92ea-e443882a780b'),
  selectedSurface: descriptor(
    'table-selected-row-background-color + table-selected-row-background-opacity',
    'b7537f50-bd49-44b6-a171-19943d443d24',
  ),
  border: descriptor('neutral-subdued-content-color-default', '7a058b23-341c-4dd3-83d8-358917277836'),
  focus: descriptor('focus-indicator-color', 'fe914904-a368-414b-a4ac-21c0b0340d05'),
  dangerSurface: descriptor('negative-subtle-background-color-default', '30fa3891-135b-405a-bf0f-3cc17f711079'),
  dangerText: descriptor('neutral-content-color-default', '43ca4c0d-7803-4e8e-b444-26fe70d5304c'),
};

/** Load and normalize the pinned Spectrum cascade token graph. */
export function spectrumThemePair(source: SpectrumProtocolSource): NormalizedThemePair {
  validateProtocolSource(source);
  const packageRoot = packageDirectory('@adobe/spectrum-design-data/package.json');
  const schemaRoot = packageDirectory('@adobe/design-data-spec/package.json');
  assertInstalledPackage(readJson(path.join(packageRoot, 'package.json')), source.package);
  assertInstalledPackage(readJson(path.join(schemaRoot, 'package.json')), source.schemaPackage);
  assertModeSet(readJson(resolveInside(packageRoot, source.modeSetPath)), source);
  const documents = source.tokenPaths.map((tokenPath) =>
    readJson(resolveInside(packageRoot, tokenPath)) as SpectrumTokenDocument,
  );
  return parseSpectrumThemePair(source, documents);
}

/** Normalize already-loaded documents so graph and mapping failures are directly testable. */
export function parseSpectrumThemePair(
  source: SpectrumProtocolSource,
  documents: readonly SpectrumTokenDocument[],
): NormalizedThemePair {
  validateProtocolSource(source);
  if (documents.length !== source.tokenPaths.length) {
    throw new Error(`Expected ${source.tokenPaths.length} Spectrum token documents`);
  }
  const lightResolver = createSpectrumColorResolver(documents, source.modes.light);
  const darkResolver = createSpectrumColorResolver(documents, source.modes.dark);
  const opacity = readSelectedOpacity(documents);
  const tokens = Object.fromEntries(Object.entries(SPECTRUM_TOKENS).map(([name, item]) => {
    const light = lightResolver.resolve(item.reference);
    const dark = darkResolver.resolve(item.reference);
    const selected = name === 'selectedSurface';
    return [name, {
      name,
      light: selected ? withAlpha(light, opacity.value) : light.color,
      dark: selected ? withAlpha(dark, opacity.value) : dark.color,
      sourceToken: item.sourceToken,
      provenance: 'authored-token',
      resolutionPath: {
        light: selected ? [...light.resolutionPath, opacity.uuid] : light.resolutionPath,
        dark: selected ? [...dark.resolutionPath, opacity.uuid] : dark.resolutionPath,
      },
    }];
  })) as NormalizedThemePair['tokens'];
  return {system: 'spectrum', split: 'development', source: source.package, tokens};
}

function readSelectedOpacity(
  documents: readonly SpectrumTokenDocument[],
): {uuid: string; value: number} {
  const matches = documents.flatMap((document) => document.filter((value) =>
    isRecord(value) && value.uuid === SELECTED_OPACITY_UUID,
  ));
  if (matches.length !== 1 || !isRecord(matches[0])) {
    throw new Error('Spectrum selected-row opacity root must occur exactly once');
  }
  const token = matches[0];
  const name = isRecord(token.name) ? token.name : {};
  if (name.component !== 'table' || name.property !== 'table-selected-row-background-opacity' ||
      Object.hasOwn(token, '$ref') || typeof token.value !== 'string') {
    throw new Error('Spectrum selected-row opacity root has an invalid shape');
  }
  const value = Number(token.value);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Spectrum selected-row opacity must be finite and in [0, 1]');
  }
  return {uuid: SELECTED_OPACITY_UUID, value};
}

function withAlpha(resolution: SpectrumColorResolution, alpha: number): string {
  const color = parseCssColor(resolution.color);
  if (!color) throw new Error(`Spectrum selected color is not parseable: ${resolution.color}`);
  return formatCssColor({...color, a: alpha});
}

function assertModeSet(value: unknown, source: SpectrumProtocolSource): void {
  if (!isRecord(value) || value.specVersion !== source.schema.specVersion ||
      value.name !== 'colorScheme' || value.default !== 'light' ||
      value.$schema !== source.schema.modeSetSchemaId || !Array.isArray(value.modes) ||
      value.modes.length !== 3 || value.modes[0] !== 'light' || value.modes[1] !== 'dark' ||
      value.modes[2] !== 'wireframe') {
    throw new Error('Installed Spectrum color-scheme mode set differs from the frozen contract');
  }
}

function assertInstalledPackage(value: unknown, pin: PackagePin): void {
  if (!isRecord(value) || value.name !== pin.name || value.version !== pin.version ||
      value.license !== pin.license || installedRepository(value.repository) !== pin.repository) {
    throw new Error(`Installed package metadata differs from ${pin.name}@${pin.version}`);
  }
}

function installedRepository(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.url === 'string') {
    return value.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return undefined;
}

function packageDirectory(packageJson: string): string {
  return path.dirname(require.resolve(packageJson));
}

function resolveInside(root: string, relativePath: string): string {
  const result = path.resolve(root, relativePath);
  if (!result.startsWith(`${root}${path.sep}`)) throw new Error('Spectrum source path escapes package');
  return result;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Unable to read Spectrum source ${filePath}`, {cause: error});
  }
}

function descriptor(sourceToken: string, reference: string): SpectrumDescriptor {
  return {sourceToken, reference};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
