import {afterEach, describe, expect, it, vi} from 'vitest';
import {ImageThemeEngine} from '../../src/content/image-engine';
import {classifyVisualResource} from '../../src/vision';
import type {AssetObservation} from '../../src/vision/action-policy';
import {transformDiagramImage, type RasterImageTransform} from '../../src/content/raster-image';
vi.mock('../../src/content/raster-image', () => ({transformDiagramImage: vi.fn()}));
import {DEFAULT_THEME} from '../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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


describe('ImageThemeEngine action execution', () => {
  function fixture(transparentIcon = false, useProvider = true) {
    vi.stubGlobal('chrome', {runtime: {getURL: (path: string) => `chrome-extension://fixture/${path}`}});
    const image = document.createElement('img');
    image.src = '/original.png';
    document.body.append(image);
    Object.defineProperties(image, {
      complete: {value: true}, naturalWidth: {value: 64}, naturalHeight: {value: 64},
    });
    const pixels = {width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255])};
    const observation: AssetObservation = {
      schema: 'semantic-dark.asset-decision.v1', source: image.src, pixels,
      classification: {...classifyVisualResource(pixels), kind: 'photo', policy: 'keep', confidence: 0.9},
      canvasBackground: DEFAULT_THEME.background,
      elementBackground: getComputedStyle(image).backgroundColor,
      parentBackground: getComputedStyle(document.body).backgroundColor,
    };
    if (transparentIcon) {
      observation.classification.kind = 'icon';
      observation.classification.policy = 'recolor';
      observation.classification.features.transparentRatio = 0.5;
    }
    let answer!: (value: unknown) => void;
    const pending = new Promise<unknown>(resolve => { answer = resolve; });
    const provider = {decide: vi.fn(() => pending)};
    if (!useProvider) { observation.classification.kind = 'diagram'; observation.classification.policy = 'diagram'; }
    const engine = new ImageThemeEngine(DEFAULT_THEME, useProvider ? provider : undefined);
    vi.spyOn(engine as unknown as {observe(image: HTMLImageElement): AssetObservation}, 'observe')
      .mockReturnValue(observation);
    engine.start();
    return {image, engine, provider, answer};
  }

  it('executes an allowed provider action and restores its markers on stop', async () => {
    const {image, engine, provider, answer} = fixture();
    try {
      await vi.waitFor(() => expect(provider.decide).toHaveBeenCalledOnce());
      answer({action: 'dim'});
      await vi.waitFor(() => expect(image.getAttribute('data-semantic-dark-image-action')).toBe('provider:dim'));
      expect(image.getAttribute('data-semantic-dark-image-filter')).toBe('dim');
    } finally { engine.stop(); }
    expect(image.hasAttribute('data-semantic-dark-image-action')).toBe(false);
    expect(image.hasAttribute('data-semantic-dark-image-filter')).toBe(false);
  });

  it('executes a transparent-artwork backplate without modifying source pixels or inline styles', async () => {
    const {image, engine, provider, answer} = fixture(true);
    const original = image.getAttribute('src');
    const style = image.getAttribute('style');
    try {
      await vi.waitFor(() => expect(provider.decide).toHaveBeenCalledOnce());
      answer({action: 'backplate'});
      await vi.waitFor(() => expect(image.getAttribute('data-semantic-dark-image-filter')).toBe('backplate'));
      expect(getComputedStyle(image).backgroundColor).toBe('rgb(255, 255, 255)');
      expect(image.getAttribute('src')).toBe(original);
      expect(image.getAttribute('style')).toBe(style);
    } finally { engine.stop(); }
    expect(image.getAttribute('src')).toBe(original);
    expect(image.getAttribute('style')).toBe(style);
    expect(image.hasAttribute('data-semantic-dark-image-filter')).toBe(false);
  });

  it('keeps a default diagram result valid when prepaint changes only its parent background', async () => {
    let finish!: (value: RasterImageTransform) => void;
    vi.mocked(transformDiagramImage).mockImplementationOnce(async () => new Promise(resolve => { finish = resolve; }));
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:diagram-fixture'; }
      static revokeObjectURL = revoke;
    });
    const {image, engine} = fixture(false, false);
    const original = image.getAttribute('src');
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      document.body.style.backgroundColor = '#333';
      finish({blob: new Blob(['png']), failureReason: null, durationMs: 1, mainThreadDurationMs: 0,
        dispatchDurationMs: 0, workerDurationMs: 1, workerMode: 'dedicated', report: {
          status: 'recolored', reason: null, pixelCount: 1, sampledPixels: 1, opaqueSampleWeight: 1,
          transparentPixels: 0, recoloredPixels: 1, edgePixels: 0, backgroundShare: 1, backgroundBorderShare: 1,
          rolePixels: {background: 1, text: 0, accent: 0}, palette: [],
        }});
      await vi.waitFor(() => expect(image.getAttribute('data-semantic-dark-raster-status')).toBe('recolored'));
      expect(image.getAttribute('src')).toBe('blob:diagram-fixture');
    } finally { engine.stop(); }
    expect(image.getAttribute('src')).toBe(original);
    expect(revoke).toHaveBeenCalledWith('blob:diagram-fixture');
  });

  it.each(['source', 'background', 'disabled', 'detached'])('discards a late action when %s changes', async change => {
    const {image, engine, provider, answer} = fixture();
    try {
      await vi.waitFor(() => expect(provider.decide).toHaveBeenCalledOnce());
      if (change === 'source') image.src = '/replacement.png';
      if (change === 'background') document.body.style.backgroundColor = '#fff';
      if (change === 'disabled') engine.update({...DEFAULT_THEME, enabled: false});
      if (change === 'detached') image.remove();
      answer({action: 'dim'});
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(image.hasAttribute('data-semantic-dark-image-action')).toBe(false);
      expect(image.hasAttribute('data-semantic-dark-image-filter')).toBe(false);
    } finally { engine.stop(); }
  });
});
