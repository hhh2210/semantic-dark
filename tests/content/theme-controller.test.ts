import {afterEach, describe, expect, it} from 'vitest';
import type {
  NativeThemeDecision,
  NativeThemeDetectorLike,
  NativeThemeKind,
} from '../../src/content/native-dark';
import {
  ThemeController,
  type ThemeEngineLike,
} from '../../src/content/theme-controller';
import {DEFAULT_THEME, type ThemeConfig, type ThemeMode} from '../../src/types';

const EVIDENCE = {
  forcedColors: false,
  negotiatedDark: false,
  rootDarkMarker: false,
  knownSamples: 9,
  darkCoverage: 0,
  lightCoverage: 1,
  lightOnDarkCoherence: 0,
  darkOnLightCoherence: 1,
};

function result(kind: NativeThemeKind): NativeThemeDecision {
  return {kind, reason: `fixture-${kind}`, evidence: EVIDENCE};
}

class FakeDetector implements NativeThemeDetectorLike {
  private change: (() => void) | null = null;
  readonly samples: NativeThemeDecision[];
  readonly activeMarkers: boolean[] = [];

  constructor(...samples: NativeThemeDecision[]) {
    this.samples = [...samples];
  }

  sample(): NativeThemeDecision {
    this.activeMarkers.push(document.documentElement.hasAttribute('data-semantic-dark-active'));
    return this.samples.shift() ?? result('ambiguous');
  }

  start(onChange: () => void): void { this.change = onChange; }
  stop(): void { this.change = null; }
  emit(): void { this.change?.(); }
}

class FakeEngine implements ThemeEngineLike {
  readonly enabled: boolean[] = [];
  update(config: ThemeConfig): void { this.enabled.push(config.enabled); }
}

function config(mode: ThemeMode): ThemeConfig {
  return {...DEFAULT_THEME, mode, enabled: mode !== 'off'};
}

function harness(mode: ThemeMode, detector: FakeDetector, settle = async (): Promise<void> => {}) {
  const dom = new FakeEngine();
  const svg = new FakeEngine();
  const image = new FakeEngine();
  const controller = new ThemeController(config(mode), detector, {dom, svg, image}, {
    settle,
    stableDelay: async () => {},
    debounceMs: 0,
  });
  return {controller, dom, svg, image};
}

afterEach(() => {
  document.documentElement.removeAttribute('data-semantic-dark-active');
});

describe('ThemeController', () => {
  it('leaves a native dark page completely inactive in auto mode', async () => {
    const state = harness('auto', new FakeDetector(result('native-dark')));
    await state.controller.start();
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'native-dark',
    });
    expect(state.dom.enabled).toEqual([]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(false);
  });

  it('requires two stable light samples before activating', async () => {
    const state = harness('auto', new FakeDetector(result('light'), result('light')));
    await state.controller.start();
    expect(state.controller.getStatus().decision).toBe('applied-light');
    expect(state.dom.enabled).toEqual([true]);
    expect(state.svg.enabled).toEqual([true]);
    expect(state.image.enabled).toEqual([true]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(true);
  });

  it('restores all engines before a dynamic native-dark decision', async () => {
    const detector = new FakeDetector(result('light'), result('light'), result('native-dark'));
    const state = harness('auto', detector);
    await state.controller.start();
    await state.controller.recheck();
    expect(state.controller.getStatus().decision).toBe('native-dark');
    expect(state.image.enabled).toEqual([true, false]);
    expect(state.svg.enabled).toEqual([true, false]);
    expect(state.dom.enabled).toEqual([true, false]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(false);
  });

  it('samples an active light page without stopping or restarting its engines', async () => {
    const detector = new FakeDetector(
      result('light'), result('light'), result('light'), result('light'),
    );
    const state = harness('auto', detector);
    await state.controller.start();
    await state.controller.recheck();

    expect(state.controller.getStatus().decision).toBe('applied-light');
    expect(state.dom.enabled).toEqual([true]);
    expect(state.svg.enabled).toEqual([true]);
    expect(state.image.enabled).toEqual([true]);
    expect(detector.activeMarkers).toEqual([false, false, false, false]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(true);
  });

  it('fails closed on ambiguous evidence', async () => {
    const state = harness('auto', new FakeDetector(result('ambiguous')));
    await state.controller.start();
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'ambiguous',
    });
  });

  it('lets an explicit force-on override native detection', async () => {
    const state = harness('on', new FakeDetector(result('native-dark')));
    await state.controller.start();
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: true,
      decision: 'user-on',
    });
    expect(state.dom.enabled).toEqual([true]);
  });

  it('cancels a stale auto probe when the user turns the site off', async () => {
    let release = (): void => {};
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const state = harness('auto', new FakeDetector(result('light'), result('light')), () => waiting);
    const starting = state.controller.start();
    await Promise.resolve();
    await state.controller.update(config('off'));
    release();
    await starting;
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'user-off',
    });
    expect(state.dom.enabled).toEqual([]);
  });
});
