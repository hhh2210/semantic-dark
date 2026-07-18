import {afterEach, describe, expect, it, vi} from 'vitest';
import {ImageThemeEngine} from '../../src/content/image-engine';
import {DEFAULT_THEME} from '../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('ImageThemeEngine cancellation', () => {
  it('does not write late classification markers after disable', async () => {
    vi.stubGlobal('chrome', {
      runtime: {getURL: (path: string) => `chrome-extension://fixture/${path}`},
    });
    const image = document.createElement('img');
    document.body.append(image);
    Object.defineProperties(image, {
      complete: {configurable: true, value: false},
      naturalWidth: {configurable: true, value: 64},
      naturalHeight: {configurable: true, value: 64},
    });
    let finishDecode = (): void => {};
    const decoded = new Promise<void>((resolve) => { finishDecode = resolve; });
    image.decode = vi.fn(() => decoded);

    const engine = new ImageThemeEngine(DEFAULT_THEME);
    engine.start();
    await Promise.resolve();
    engine.update({...DEFAULT_THEME, mode: 'off', enabled: false});
    finishDecode();
    await decoded;
    await Promise.resolve();

    expect(image.hasAttribute('data-semantic-dark-image-kind')).toBe(false);
    expect(image.hasAttribute('data-semantic-dark-image-filter')).toBe(false);
    expect(image.hasAttribute('data-semantic-dark-raster-status')).toBe(false);
    engine.stop();
  });
});
