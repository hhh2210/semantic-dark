import {PNG} from 'pngjs';

import type {M0V2Manifest} from './m0-types';
import {verifyM0V2ExternalArtifact} from './m0-repository';
import {exactKeys, literal, nonEmpty, object} from './m0-validation-primitives';

export interface VerifiedM0V2A3Evidence {
  sourcePath: string;
  resultPath: string;
  screenshotPath: string;
  chromeVersion: string;
  viewport: M0V2Manifest['environment']['a3ProbeViewport'];
}

/** Authenticate and semantically replay the pre-intervention four-stage probe. */
export async function verifyM0V2A3Evidence(
  root: string,
  document: Readonly<M0V2Manifest>,
): Promise<Readonly<VerifiedM0V2A3Evidence>> {
  const [source, resultArtifact, screenshot] = await Promise.all([
    verifyM0V2ExternalArtifact(root, document.a3.artifacts.source,
      'M0-v2 A3 probe source', 'probe.ts'),
    verifyM0V2ExternalArtifact(root, document.a3.artifacts.result,
      'M0-v2 A3 probe result', 'probe-result.json'),
    verifyM0V2ExternalArtifact(root, document.a3.artifacts.screenshot,
      'M0-v2 A3 probe screenshot', 'quantization.png'),
  ]);
  let parsed: unknown;
  try { parsed = JSON.parse(resultArtifact.bytes.toString('utf8')) as unknown; } catch (error) {
    throw new Error('M0-v2 A3 probe result is invalid JSON', {cause: error});
  }
  const result = validateProbeResult(parsed, document);
  const png = PNG.sync.read(screenshot.bytes);
  const viewport = document.environment.a3ProbeViewport;
  if (png.width !== viewport.width * viewport.deviceScaleFactor ||
      png.height !== viewport.height * viewport.deviceScaleFactor) {
    throw new Error('M0-v2 A3 screenshot dimensions disagree with the frozen viewport');
  }
  const card = sample(png, 50, 50);
  const raised = sample(png, 170, 50);
  if (!equalRgba(card, result.screenshotPixels.card) ||
      !equalRgba(raised, result.screenshotPixels.raised)) {
    throw new Error('M0-v2 A3 screenshot pixels disagree with the parsed probe result');
  }
  return Object.freeze({sourcePath: source.resolvedPath, resultPath: resultArtifact.resolvedPath,
    screenshotPath: screenshot.resolvedPath, chromeVersion: result.chromeVersion, viewport});
}

function validateProbeResult(value: unknown, document: Readonly<M0V2Manifest>) {
  const input = object(value, 'M0-v2 A3 probe result');
  exactKeys(input, ['chromeVersion', 'mapperMemory', 'cssRoundTrip', 'chromeComputed',
    'backdropComposite', 'screenshotPixels'], 'M0-v2 A3 probe result');
  const chromeVersion = nonEmpty(input.chromeVersion, 'A3 chromeVersion');
  literal(chromeVersion, document.environment.chromeVersion, 'A3 chromeVersion');
  const mapperMemory = object(input.mapperMemory, 'A3 mapperMemory');
  exactKeys(mapperMemory, ['card', 'raised', 'ratio'], 'A3 mapperMemory');
  rgbaFloat(mapperMemory.card, 'A3 mapperMemory.card',
    [0.12530918065797472, 0.12530915853537825, 0.1253090986536019, 1]);
  rgbaFloat(mapperMemory.raised, 'A3 mapperMemory.raised',
    [0.1609007013093135, 0.1609006710307492, 0.16090058907227472, 1]);
  literal(mapperMemory.ratio, document.a3.stages.mapperInMemory, 'A3 mapperMemory.ratio');

  const css = object(input.cssRoundTrip, 'A3 cssRoundTrip');
  exactKeys(css, ['card', 'raised', 'ratio'], 'A3 cssRoundTrip');
  literal(css.card, 'rgb(31.95384 31.95384 31.95382)', 'A3 cssRoundTrip.card');
  literal(css.raised, 'rgb(41.02968 41.02967 41.02965)', 'A3 cssRoundTrip.raised');
  literal(css.ratio, document.a3.stages.cssSerialized, 'A3 cssRoundTrip.ratio');

  const computed = object(input.chromeComputed, 'A3 chromeComputed');
  exactKeys(computed, ['card', 'raised', 'ratio'], 'A3 chromeComputed');
  literal(computed.card, 'rgb(32, 32, 32)', 'A3 chromeComputed.card');
  literal(computed.raised, 'rgb(41, 41, 41)', 'A3 chromeComputed.raised');
  literal(computed.ratio, document.a3.stages.chromeComputedStyle,
    'A3 chromeComputed.ratio');

  const composite = object(input.backdropComposite, 'A3 backdropComposite');
  exactKeys(composite, ['card', 'raised', 'ratio'], 'A3 backdropComposite');
  rgbaFloat(composite.card, 'A3 backdropComposite.card',
    [0.12549019607843137, 0.12549019607843137, 0.12549019607843137, 1]);
  rgbaFloat(composite.raised, 'A3 backdropComposite.raised',
    [0.1607843137254902, 0.1607843137254902, 0.1607843137254902, 1]);
  literal(composite.ratio, document.a3.stages.afterBackdropCompositing,
    'A3 backdropComposite.ratio');

  const pixels = object(input.screenshotPixels, 'A3 screenshotPixels');
  exactKeys(pixels, ['card', 'raised'], 'A3 screenshotPixels');
  const screenshotPixels = {
    card: rgba8(pixels.card, 'A3 screenshotPixels.card', [32, 32, 32, 255]),
    raised: rgba8(pixels.raised, 'A3 screenshotPixels.raised', [41, 41, 41, 255]),
  };
  return {chromeVersion, screenshotPixels};
}

function rgbaFloat(value: unknown, label: string, expected: readonly number[]): void {
  const input = object(value, label);
  exactKeys(input, ['r', 'g', 'b', 'a'], label);
  for (const [index, key] of ['r', 'g', 'b', 'a'].entries()) {
    literal(input[key], expected[index], `${label}.${key}`);
  }
}

function rgba8(value: unknown, label: string, expected: readonly number[]): readonly number[] {
  if (!Array.isArray(value) || value.length !== 4 ||
      value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} differs from the frozen RGBA8 sample`);
  }
  return expected;
}

function sample(png: PNG, x: number, y: number): number[] {
  if (x >= png.width || y >= png.height) throw new Error('A3 screenshot sample is out of bounds');
  const offset = (y * png.width + x) * 4;
  return [...png.data.subarray(offset, offset + 4)];
}

function equalRgba(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
