import {expect, it, vi} from 'vitest';
import {classifyVisualResource} from '../../src/vision';
import {decideAsset, type AssetObservation} from '../../src/vision/action-policy';
import {logoActionContrast} from '../../src/vision/logo-contrast';

function observation(rgb: number[]): AssetObservation {
  const data = Uint8ClampedArray.from(Array.from({length: 16}, (_, i) => [...rgb, i < 12 ? 255 : 0]).flat());
  const pixels = {width: 4, height: 4, data};
  return {schema: 'semantic-dark.asset-decision.v1', source: 'logo', pixels,
    classification: {...classifyVisualResource(pixels), kind: 'icon', policy: 'keep', confidence: 0.9},
    elementBackground: 'transparent', parentBackground: '#333', canvasBackground: '#111416', simpleBackdrop: true};
}

it('repairs a dark transparent logo with a white backing without invoking a model', async () => {
  const input = observation([30, 40, 80]);
  const contrast = logoActionContrast(input)!;
  expect(contrast.keep).toBeLessThan(3);
  expect(contrast.backplate).toBeGreaterThanOrEqual(3);
  const provider = {decide: vi.fn()};
  expect(await decideAsset(input, provider, new AbortController().signal))
    .toMatchObject({action: 'backplate', authority: 'constraint'});
  expect(provider.decide).not.toHaveBeenCalled();
});

it('rejects a model-selected white backing that would hide bright logo strokes', async () => {
  const input = observation([80, 220, 255]);
  expect(await decideAsset(input, {decide: async () => ({action: 'backplate'})}, new AbortController().signal))
    .toMatchObject({action: 'keep', reason: 'logo-contrast-rejected'});
});

it('does not infer a solid backdrop for an unknown/complex background', async () => {
  const input = {...observation([30, 40, 80]), simpleBackdrop: false};
  expect(logoActionContrast(input)).toBeNull();
  expect(await decideAsset(input, undefined, new AbortController().signal))
    .toMatchObject({action: 'keep', authority: 'heuristic'});
});


it.each(['confidence', 'transparency'])('rejects non-finite %s before forcing a logo action', async field => {
  const input = observation([30, 40, 80]);
  if (field === 'confidence') input.classification.confidence = NaN;
  else input.classification.features.transparentRatio = NaN;
  expect(logoActionContrast(input)).toBeNull();
  expect(await decideAsset(input, undefined, new AbortController().signal)).toMatchObject({action: 'keep'});
});


it('does not turn readable dark strokes white on a light mapped surface', async () => {
  const input = observation([20, 20, 20]);
  input.parentBackground = '#fff'; input.classification.policy = 'recolor';
  expect(await decideAsset(input, undefined, new AbortController().signal))
    .toMatchObject({action: 'keep', reason: 'logo-already-readable'});
});
