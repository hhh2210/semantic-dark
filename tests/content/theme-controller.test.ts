import {afterEach, describe, expect, it} from 'vitest';
import type {
  NativeThemeDecision,
  NativeThemeDetectorLike,
  NativeThemeKind,
} from '../../src/content/native-dark';
import type {OfficialThemeLaneLike, OfficialThemeProbe} from '../../src/content/official-theme';
import {
  ThemeController,
  type ThemeEngineLike,
} from '../../src/content/theme-controller';
import {DEFAULT_THEME, type ThemeConfig, type ThemeMode} from '../../src/types';

const EVIDENCE = {
  forcedColors: false,
  negotiatedDark: false,
  declaredLight: false,
  lightCanvas: false,
  visibleContent: true,
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
  private dark = true;
  readonly samples: NativeThemeDecision[];
  readonly activeMarkers: boolean[] = [];

  constructor(...samples: NativeThemeDecision[]) {
    this.samples = [...samples];
  }

  prefersDark(): boolean { return this.dark; }
  sample(): NativeThemeDecision {
    this.activeMarkers.push(document.documentElement.hasAttribute('data-semantic-dark-active'));
    return this.samples.shift() ?? result('ambiguous');
  }

  start(onChange: () => void): void { this.change = onChange; }
  stop(): void { this.change = null; }
  emit(): void { this.change?.(); }
  setSystemDark(dark: boolean): void {
    this.dark = dark;
    this.emit();
  }
}

class FakeOfficial implements OfficialThemeLaneLike {
  applied = false;
  activateResult = true;
  restores = 0;
  activates = 0;

  probe(): OfficialThemeProbe {
    return {
      capable: this.activateResult,
      source: this.activateResult ? 'catalog' : 'none',
      catalogId: this.activateResult ? 'zhihu' : null,
      recipes: [],
    };
  }

  activate(): boolean {
    this.activates += 1;
    this.applied = this.activateResult;
    return this.activateResult;
  }

  restore(): void {
    this.restores += 1;
    this.applied = false;
  }

  isApplied(): boolean {
    return this.applied;
  }
}

class FakeEngine implements ThemeEngineLike {
  readonly enabled: boolean[] = [];
  update(config: ThemeConfig): void { this.enabled.push(config.enabled); }
}

function config(mode: ThemeMode): ThemeConfig {
  return {...DEFAULT_THEME, mode, enabled: mode !== 'off'};
}

function inertOfficial(): FakeOfficial {
  const lane = new FakeOfficial();
  lane.activateResult = false;
  return lane;
}

function harness(
  mode: ThemeMode,
  detector: FakeDetector,
  settle = async (): Promise<void> => {},
  official: FakeOfficial = inertOfficial(),
) {
  const dom = new FakeEngine();
  const svg = new FakeEngine();
  const image = new FakeEngine();
  const controller = new ThemeController(config(mode), detector, {dom, svg, image}, {
    settle,
    stableDelay: async () => {},
    debounceMs: 0,
    officialTheme: official,
  });
  return {controller, dom, svg, image, official};
}

afterEach(() => {
  document.documentElement.removeAttribute('data-semantic-dark-active');
});

describe('ThemeController', () => {
  it('stays inactive in auto mode while the system uses light appearance', async () => {
    const detector = new FakeDetector(result('light'), result('light'));
    detector.setSystemDark(false);
    const state = harness('auto', detector);
    await state.controller.start();

    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'system-light',
    });
    expect(detector.samples).toHaveLength(2);
    expect(state.dom.enabled).toEqual([]);
  });

  it('follows system appearance changes in auto mode', async () => {
    const detector = new FakeDetector(result('light'), result('light'));
    detector.setSystemDark(false);
    const state = harness('auto', detector);
    await state.controller.start();

    detector.setSystemDark(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: true,
      decision: 'applied-light',
    });

    detector.setSystemDark(false);
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'system-light',
    });
    expect(state.dom.enabled).toEqual([true, false]);
  });

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

  it('prefers a reversible official dark switch over the Semantic Dark transform', async () => {
    const official = new FakeOfficial();
    const state = harness(
      'auto',
      new FakeDetector(result('light'), result('light'), result('native-dark')),
      async () => {},
      official,
    );
    await state.controller.start();

    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: false,
      decision: 'official-dark',
      reason: 'official-theme-activated',
    });
    expect(official.activates).toBe(1);
    expect(official.applied).toBe(true);
    expect(state.dom.enabled).toEqual([]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(false);
  });

  it('falls back to the transform when official activation does not darken the page', async () => {
    const official = new FakeOfficial();
    const state = harness(
      'auto',
      new FakeDetector(result('light'), result('light'), result('light')),
      async () => {},
      official,
    );
    await state.controller.start();

    expect(state.controller.getStatus().decision).toBe('applied-light');
    expect(official.activates).toBe(1);
    expect(official.restores).toBeGreaterThanOrEqual(1);
    expect(official.applied).toBe(false);
    expect(state.dom.enabled).toEqual([true]);
  });

  it('restores an official theme mutation when the system returns to light', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(result('light'), result('light'), result('native-dark'));
    detector.setSystemDark(true);
    const state = harness('auto', detector, async () => {}, official);
    await state.controller.start();
    expect(state.controller.getStatus().decision).toBe('official-dark');

    detector.setSystemDark(false);
    expect(state.controller.getStatus().decision).toBe('system-light');
    expect(official.applied).toBe(false);
    expect(official.restores).toBeGreaterThanOrEqual(1);
  });

  it('restores official theme before a manual force-on override', async () => {
    const official = new FakeOfficial();
    const state = harness(
      'auto',
      new FakeDetector(result('light'), result('light'), result('native-dark')),
      async () => {},
      official,
    );
    await state.controller.start();
    await state.controller.update(config('on'));

    expect(official.applied).toBe(false);
    expect(state.controller.getStatus()).toMatchObject({
      effectiveEnabled: true,
      decision: 'user-on',
    });
    expect(state.dom.enabled).toEqual([true]);
  });
});
