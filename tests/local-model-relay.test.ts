import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {relayAssetDecision, type AssetDecisionMessage} from '../src/local-model-relay';
import {DEFAULT_THEME} from '../src/types';

const message: AssetDecisionMessage = {type: 'semantic-dark:asset-decision',
  pixels: {width: 1, height: 1, data: [20, 30, 60, 255]},
  background: '#333', canvasBackground: '#111416', allowed: ['keep', 'dim', 'backplate']};
const sender = {tab: {id: 1}, url: 'https://example.com/page'} as chrome.runtime.MessageSender;
let localModel = true;
const request = vi.fn();
beforeEach(() => {
  localModel = true;
  request.mockReset().mockResolvedValue({ok: true, json: async () => ({action: 'backplate'})});
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('chrome', {storage: {local: {get: async () => ({
    'semantic-dark:example.com': {...DEFAULT_THEME, localModel},
  })}}});
});
afterEach(() => vi.unstubAllGlobals());

it('checks the sender host opt-in before sending any pixels', async () => {
  localModel = false;
  expect(await relayAssetDecision(message, sender)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it('sends only bounded pixels and colors to the fixed loopback endpoint', async () => {
  expect(await relayAssetDecision(message, sender)).toEqual({action: 'backplate', cached: false});
  const [url, options] = request.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:18949/decide');
  expect(JSON.parse(options.body)).toEqual({pixels: message.pixels, background: '#333',
    canvasBackground: '#111416', allowed: message.allowed});
  expect(options.body).not.toContain('example.com');
});

it.each([{width: 129, height: 1, data: [0]}, {width: 1, height: 1, data: [0, 0, -1, 255]}])(
  'rejects invalid pixel budgets and byte values', async pixels => {
    expect(await relayAssetDecision({...message, pixels}, sender)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

it('rejects backend actions outside the request allowlist', async () => {
  request.mockResolvedValue({ok: true, json: async () => ({action: 'diagram'})});
  expect(await relayAssetDecision(message, sender)).toBeNull();
});

it('falls back when the companion is absent or busy', async () => {
  request.mockRejectedValueOnce(Error('connection refused'));
  expect(await relayAssetDecision(message, sender)).toBeNull();
  request.mockResolvedValueOnce({ok: false});
  expect(await relayAssetDecision(message, sender)).toBeNull();
});
