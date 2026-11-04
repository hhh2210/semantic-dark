import {afterEach, describe, expect, it, vi} from 'vitest';
import {allowedAssetActions, decideAsset, type AssetObservation} from '../../src/vision/action-policy';
import {classifyVisualResource} from '../../src/vision';

const pixels = {width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255])};
function observation(): AssetObservation {
  return {schema: 'semantic-dark.asset-decision.v1', source: 'local.png', pixels,
    classification: {...classifyVisualResource(pixels), kind: 'diagram', policy: 'diagram', confidence: 0.9},
    canvasBackground: '#111416', elementBackground: 'transparent', parentBackground: '#333'};
}
afterEach(() => vi.useRealTimers());

describe('asset action decision boundary', () => {
  it('keeps the current router as the default and explicitly identifies its authority', async () => {
    const result = await decideAsset(observation(), undefined, new AbortController().signal);
    expect(result).toEqual({action: 'diagram', authority: 'heuristic', reason: 'existing-feature-router'});
  });

  it('allows a provider to preserve an otherwise recolored asset', async () => {
    const provider = {decide: vi.fn(async () => ({action: 'keep'}))};
    expect(await decideAsset(observation(), provider, new AbortController().signal))
      .toMatchObject({action: 'keep', authority: 'provider'});
    expect(provider.decide.mock.calls[0]).toEqual([observation(), ['keep', 'dim', 'diagram'], expect.any(AbortSignal)]);
  });

  it.each([null, {}, {action: 'invert-page'}, {action: 'monochrome'}, {action: 1}])(
    'rejects invalid or inadmissible provider response %j', async (answer) => {
      expect(await decideAsset(observation(), {decide: async () => answer}, new AbortController().signal))
        .toMatchObject({action: 'keep', authority: 'fallback', reason: 'invalid-or-disallowed-action'});
    });

  it('offers a white backing only for eligible transparent artwork', () => {
    const classification = observation().classification;
    expect(allowedAssetActions(classification)).not.toContain('backplate');
    classification.features.transparentRatio = 0.5;
    expect(allowedAssetActions(classification)).toContain('backplate');
  });

  it('never lets a photo decision select monochrome or diagram recoloring', () => {
    expect(allowedAssetActions({...observation().classification, kind: 'photo'})).toEqual(['keep', 'dim']);
  });

  it.each([0.57, NaN, Infinity])('does not call a model below the existing eligibility gate (%s)', async confidence => {
    const input = observation(); input.classification.confidence = confidence;
    const provider = {decide: vi.fn()};
    expect(await decideAsset(input, provider, new AbortController().signal)).toMatchObject({action: 'keep'});
    expect(provider.decide).not.toHaveBeenCalled();
  });

  it('bounds a hung provider and aborts its request', async () => {
    vi.useFakeTimers();
    let requestSignal!: AbortSignal;
    const result = decideAsset(observation(), {decide: async (_input, _allowed, signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    }}, new AbortController().signal, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({action: 'keep', reason: 'timeout'});
    expect(requestSignal.aborted).toBe(true);
  });

  it('cancels without waiting for a provider that ignores abort', async () => {
    const abort = new AbortController();
    const result = decideAsset(observation(), {decide: async () => new Promise(() => {})}, abort.signal);
    abort.abort();
    expect(await result).toMatchObject({action: 'keep', reason: 'cancelled'});
  });

  it('preserves the source on backend failure', async () => {
    expect(await decideAsset(observation(), {decide: async () => { throw Error('unavailable'); }},
      new AbortController().signal)).toMatchObject({action: 'keep', reason: 'provider-error'});
  });
});
