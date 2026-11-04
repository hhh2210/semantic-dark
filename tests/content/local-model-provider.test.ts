import {afterEach, expect, it, vi} from 'vitest';
import {localModelProvider} from '../../src/content/local-model-provider';
import {classifyVisualResource} from '../../src/vision';
import type {AssetObservation} from '../../src/vision/action-policy';

afterEach(() => vi.unstubAllGlobals());
it('composites the image background over its parent and sends no source URL', async () => {
  const send = vi.fn(async () => ({action: 'keep'}));
  vi.stubGlobal('chrome', {runtime: {sendMessage: send}});
  const pixels = {width: 1, height: 1, data: [30, 40, 80, 255]};
  const observation: AssetObservation = {schema: 'semantic-dark.asset-decision.v1',
    source: 'https://private.example/image.png', pixels, classification: classifyVisualResource(pixels),
    elementBackground: 'rgba(255,255,255,0.5)', parentBackground: '#000', canvasBackground: '#111416'};
  expect(localModelProvider.requiresOptIn).toBe(true);
  await localModelProvider.decide(observation, ['keep', 'dim', 'diagram', 'backplate'], new AbortController().signal);
  expect(send).toHaveBeenCalledWith({type: 'semantic-dark:asset-decision', pixels,
    background: 'rgb(128 128 128)', canvasBackground: '#111416', allowed: ['keep', 'dim', 'backplate']});
});
