import {afterEach, describe, expect, it} from 'vitest';
import type {
  NativeThemeDecision,
  NativeThemeDetectorLike,
  NativeThemeKind,
} from '../../src/content/native-dark';
import type {OfficialThemeRecipe} from '../../src/content/official-theme-recipes';
import type {OfficialThemeLaneLike, OfficialThemeProbe} from '../../src/content/official-theme';
import {
  ThemeController,
  type ThemeEngineLike,
} from '../../src/content/theme-controller';
import {DEFAULT_THEME, type ThemeConfig, type ThemeMode} from '../../src/types';

const LIGHT_EVIDENCE = {
  forcedColors: false,
  negotiatedDark: false,
  declaredLight: false,
  lightCanvas: true,
  visibleContent: true,
  rootDarkMarker: false,
  knownSamples: 9,
  darkCoverage: 0,
  lightCoverage: 1,
  lightOnDarkCoherence: 0,
  darkOnLightCoherence: 1,
};

const DARK_EVIDENCE = {
  ...LIGHT_EVIDENCE,
  lightCanvas: false,
  darkCoverage: 0.86,
  lightCoverage: 0,
  lightOnDarkCoherence: 0.8,
  darkOnLightCoherence: 0,
};

function result(kind: NativeThemeKind): NativeThemeDecision {
  if (kind === 'native-dark') {
    return {kind, reason: 'dark-rendered-surfaces', evidence: DARK_EVIDENCE};
  }
  return {kind, reason: `fixture-${kind}`, evidence: LIGHT_EVIDENCE};
}

function markerOnlyNativeDark(): NativeThemeDecision {
  return {
    kind: 'native-dark',
    reason: 'active-root-dark-marker',
    evidence: LIGHT_EVIDENCE,
  };
}

class FakeDetector implements NativeThemeDetectorLike {
  private change: ((stylesChanged?: boolean, loadedStylesheet?: Element) => void) | null = null;
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

  start(onChange: (stylesChanged?: boolean, loadedStylesheet?: Element) => void): void { this.change = onChange; }
  stop(): void { this.change = null; }
  emit(stylesChanged = false, loadedStylesheet?: Element): void { this.change?.(stylesChanged, loadedStylesheet); }
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
  recipes: OfficialThemeRecipe[] = [{type: 'attribute', target: 'html', name: 'data-theme', value: 'dark'}];
  readonly attempted: Array<readonly OfficialThemeRecipe[]> = [];

  probe(): OfficialThemeProbe {
    return {
      capable: this.activateResult,
      source: this.activateResult ? 'catalog' : 'none',
      catalogId: this.activateResult ? 'zhihu' : null,
      recipes: this.activateResult ? this.recipes : [],
      targets: {html: document.documentElement, body: document.body},
    };
  }

  activate(recipes: readonly OfficialThemeRecipe[] = []): boolean {
    this.attempted.push(recipes);
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
  readonly configs: ThemeConfig[] = [];
  update(config: ThemeConfig): void {
    this.enabled.push(config.enabled);
    this.configs.push(config);
  }
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
      new FakeDetector(result('light'), result('light'), result('light'), result('light'), result('light')),
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

  it('does not keep an official marker that failed to visually darken the page', async () => {
    const official = new FakeOfficial();
    const state = harness(
      'auto',
      new FakeDetector(result('light'), result('light'), markerOnlyNativeDark(), result('light'), result('light')),
      async () => {},
      official,
    );
    await state.controller.start();

    expect(state.controller.getStatus().decision).toBe('applied-light');
    expect(official.applied).toBe(false);
    expect(state.dom.enabled).toEqual([true]);
  });
});

function deferred() {
  let resolve = (): void => {};
  let reject = (_error: Error): void => {};
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

class WaitingOfficial extends FakeOfficial {
  waits: ReturnType<typeof deferred>[] = [];
  signals: AbortSignal[] = [];
  settle(signal: AbortSignal): Promise<void> {
    const wait = deferred();
    this.waits.push(wait);
    this.signals.push(signal);
    return wait.promise;
  }
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 30 && !check(); i += 1) await Promise.resolve();
  expect(check()).toBe(true);
}

describe('ThemeController async reconciliation', () => {
  it.each(['off', 'on'] as const)('cancels pending CSS on auto -> %s -> auto without stale rollback', async (mode) => {
    const official = new WaitingOfficial();
    const detector = new FakeDetector(result('light'), result('light'));
    const {controller} = harness('auto', detector, async () => {}, official);
    const first = controller.start();
    await until(() => official.waits.length === 1);
    await controller.update(config(mode));
    expect(official.applied).toBe(false);
    expect(official.signals[0]?.aborted).toBe(true);
    expect(controller.getStatus().decision).toBe(`user-${mode}`);
    detector.samples.push(result('light'), result('light'), result('native-dark'));
    const second = controller.update(config('auto'));
    await until(() => official.waits.length === 2);
    official.waits[1]!.resolve();
    await second;
    expect(controller.getStatus().decision).toBe('official-dark');
    const restores = official.restores;
    official.waits[0]!.resolve();
    await first;
    expect(controller.getStatus().decision).toBe('official-dark');
    expect(official.applied).toBe(true);
    expect(official.restores).toBe(restores);
    controller.stop();
  });

  it('reconciles same-mode updates while CSS is pending', async () => {
    const official = new WaitingOfficial();
    const detector = new FakeDetector(result('light'), result('light'));
    const {controller} = harness('auto', detector, async () => {}, official);
    const first = controller.start();
    await until(() => official.waits.length === 1);
    detector.samples.push(result('light'), result('light'), result('native-dark'));
    const second = controller.update({...config('auto'), minimumTextContrast: 7});
    await until(() => official.waits.length === 2);
    official.waits[0]!.reject(new Error('stale stylesheet failure'));
    await first;
    expect(official.applied).toBe(true);
    official.waits[1]!.resolve();
    await second;
    expect(controller.getStatus().decision).toBe('official-dark');
    controller.stop();
  });

  it('does not drop a scheduled authored-theme change on a same-mode update', async () => {
    const detector = new FakeDetector(result('native-dark'));
    const {controller} = harness('auto', detector);
    await controller.start();
    detector.samples.push(result('light'), result('light'));
    detector.emit();
    await controller.update(config('auto'));
    expect(controller.getStatus().decision).toBe('applied-light');
    controller.stop();
  });

  it.each(['system-light', 'stop'] as const)('rolls back pending official state on %s', async (action) => {
    const official = new WaitingOfficial();
    const detector = new FakeDetector(result('light'), result('light'));
    const {controller, dom} = harness('auto', detector, async () => {}, official);
    const pending = controller.start();
    await until(() => official.waits.length === 1);
    if (action === 'stop') controller.stop();
    else detector.setSystemDark(false);
    expect(official.signals[0]?.aborted).toBe(true);
    expect(official.applied).toBe(false);
    official.waits[0]!.resolve();
    await pending;
    expect(dom.enabled).toEqual([]);
    expect(official.applied).toBe(false);
    if (action === 'system-light') expect(controller.getStatus().decision).toBe('system-light');
    controller.stop();
  });

  it('rolls back on settlement failure and fails closed', async () => {
    const official = new WaitingOfficial();
    const {controller, dom} = harness('auto', new FakeDetector(result('light'), result('light')), async () => {}, official);
    const pending = controller.start();
    await until(() => official.waits.length === 1);
    official.waits[0]!.reject(new Error('stylesheet failure'));
    await pending;
    expect(official.applied).toBe(false);
    expect(controller.getStatus().decision).toBe('ambiguous');
    expect(dom.enabled).toEqual([]);
    controller.stop();
  });

  it('does not restart pending CSS on its load event and samples later site state', async () => {
    const official = new WaitingOfficial();
    const detector = new FakeDetector(result('light'), result('light'));
    const {controller} = harness('auto', detector, async () => {}, official);
    const pending = controller.start();
    await until(() => official.waits.length === 1);
    detector.emit();
    expect(official.restores).toBe(0);
    detector.samples.push(result('forced-colors'), result('forced-colors'));
    official.waits[0]!.resolve();
    await pending;
    expect(controller.getStatus().decision).toBe('forced-colors');
    expect(official.applied).toBe(false);
    controller.stop();
  });

  it('resamples after rollback instead of applying stale light evidence', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(result('light'), result('light'), markerOnlyNativeDark(), result('native-dark'));
    const {controller, dom} = harness('auto', detector, async () => {}, official);
    await controller.start();
    expect(controller.getStatus().decision).toBe('native-dark');
    expect(official.applied).toBe(false);
    expect(dom.enabled).toEqual([]);
    controller.stop();
  });

  it('resamples after a previously confirmed official theme loses visual darkness', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(result('light'), result('light'), result('native-dark'));
    const {controller, dom} = harness('auto', detector, async () => {}, official);
    await controller.start();
    detector.samples.push(markerOnlyNativeDark(), result('ambiguous'));
    await controller.recheck();
    expect(controller.getStatus().decision).toBe('ambiguous');
    expect(official.applied).toBe(false);
    expect(dom.enabled).toEqual([]);
    controller.stop();
  });

  it('keeps an active transform painted while retrying an official switch', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(...Array.from({length: 10}, () => result('light')));
    const {controller, dom} = harness('auto', detector, async () => {}, official);
    await controller.start();
    expect(dom.enabled).toEqual([true]);

    // Authored style changes (for example CSS-in-JS on click) renew the official budget.
    detector.emit(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(official.activates).toBe(2);
    expect(official.applied).toBe(false);
    expect(controller.getStatus().decision).toBe('applied-light');
    expect(dom.enabled).toEqual([true]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(true);
    controller.stop();
  });

  it('defers engine rescans while an official candidate is pending and remaps after rollback', async () => {
    class SettlingOfficial extends FakeOfficial {
      onSettle: (() => void) | null = null;
      async settle(): Promise<void> { this.onSettle?.(); }
    }
    class RescanEngine extends FakeEngine {
      rescans = 0;
      rescan(): void { this.rescans += 1; }
    }
    const official = new SettlingOfficial();
    const detector = new FakeDetector(...Array.from({length: 10}, () => result('light')));
    const dom = new RescanEngine();
    const controller = new ThemeController(config('auto'), detector,
      {dom, svg: new FakeEngine(), image: new FakeEngine()}, {
        settle: async () => {},
        stableDelay: async () => {},
        debounceMs: 0,
        officialTheme: official,
      });
    await controller.start();
    const afterStart = dom.rescans;
    let rescansWhilePending = -1;
    official.onSettle = () => {
      controller.rescan();
      rescansWhilePending = dom.rescans - afterStart;
    };

    detector.emit(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(rescansWhilePending).toBe(0);
    expect(official.applied).toBe(false);
    expect(dom.rescans - afterStart).toBe(1);
    expect(controller.getStatus().decision).toBe('applied-light');
    controller.stop();
  });

  it('hands an active transform over to a confirmed official theme', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(...Array.from({length: 5}, () => result('light')));
    const {controller, dom} = harness('auto', detector, async () => {}, official);
    await controller.start();
    detector.samples.push(result('light'), result('light'), result('native-dark'));

    detector.emit(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(controller.getStatus().decision).toBe('official-dark');
    expect(official.applied).toBe(true);
    expect(dom.enabled).toEqual([true, false]);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(false);
    controller.stop();
  });

  it('stops retrying a failed official switch after two attempts', async () => {
    const official = new FakeOfficial();
    const detector = new FakeDetector(...Array.from({length: 14}, () => result('light')));
    const {controller} = harness('auto', detector, async () => {}, official);
    await controller.start();
    await controller.recheck();
    await controller.recheck();
    expect(official.activates).toBe(2);
    expect(controller.getStatus().decision).toBe('applied-light');
    controller.stop();
  });

  it('refreshes force-on settings and restores the active marker on same-mode updates', async () => {
    const {controller, dom} = harness('on', new FakeDetector());
    await controller.start();
    document.documentElement.removeAttribute('data-semantic-dark-active');
    await controller.update({...config('on'), minimumTextContrast: 7});
    expect(dom.configs.at(-1)?.minimumTextContrast).toBe(7);
    expect(document.documentElement.hasAttribute('data-semantic-dark-active')).toBe(true);
    controller.stop();
  });

  it('does not reactivate a stopped controller via an update', async () => {
    const {controller, dom} = harness('off', new FakeDetector());
    await controller.start();
    controller.stop();
    await controller.update(config('on'));
    expect(dom.enabled).toEqual([]);
  });
});

it('resets consecutive official failures after successful SPA recovery', async () => {
  const official = new FakeOfficial();
  const detector = new FakeDetector(result('light'), result('light'), result('native-dark'));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  try {
    for (let route = 0; route < 3; route += 1) {
      detector.samples.push(result('light'), result('light'), result('light'), result('light'), result('native-dark'));
      await controller.recheck();
      expect(controller.getStatus().decision).toBe('official-dark');
    }
    expect(official.activates).toBe(4);
  } finally {
    controller.stop();
  }
});

function sheetRecipe(href: string): Extract<OfficialThemeRecipe, {type: 'stylesheet'}> {
  const link = document.createElement('link');
  link.href = href;
  link.rel = 'alternate stylesheet';
  link.title = `Dark ${href}`;
  link.disabled = true;
  return {type: 'stylesheet', link, disabled: false, media: 'all'};
}

it.each(['new link', 'changed URL'])('retries after exhausted failures when a %s changes the candidates', async (change) => {
  const official = new FakeOfficial();
  const first = sheetRecipe('/failed.css');
  official.recipes = [first];
  const detector = new FakeDetector(...Array.from({length: 12}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  await controller.recheck();
  await controller.recheck();
  expect(official.activates).toBe(2);
  if (change === 'new link') official.recipes = [sheetRecipe('/working.css')];
  else first.link.href = '/working.css';
  detector.samples.push(result('light'), result('light'), result('native-dark'));
  await controller.recheck();
  expect(official.activates).toBe(3);
  expect(controller.getStatus().decision).toBe('official-dark');
  controller.stop();
});

it('rolls back an ineffective stylesheet before trying a second variant', async () => {
  const official = new FakeOfficial();
  const first = sheetRecipe('/first.css');
  const second = sheetRecipe('/second.css');
  official.recipes = [first, second];
  const {controller} = harness('auto', new FakeDetector(
    result('light'), result('light'), result('light'), result('light'), result('native-dark'),
  ), async () => {}, official);
  await controller.start();
  expect(official.attempted).toEqual([[first], [second]]);
  expect(official.restores).toBe(1);
  expect(controller.getStatus().decision).toBe('official-dark');
  controller.stop();
});

it('does not try another stylesheet over a concurrent native theme after rollback', async () => {
  const official = new FakeOfficial();
  official.recipes = [sheetRecipe('/first.css'), sheetRecipe('/second.css')];
  const {controller, dom} = harness('auto', new FakeDetector(
    result('light'), result('light'), result('light'), result('native-dark'), result('native-dark'),
  ), async () => {}, official);
  await controller.start();
  expect(official.activates).toBe(1);
  expect(official.applied).toBe(false);
  expect(controller.getStatus().decision).toBe('native-dark');
  expect(dom.enabled).toEqual([]);
  controller.stop();
});

it('cancels settlement of a later stylesheet candidate without retaining either variant', async () => {
  const official = new WaitingOfficial();
  official.recipes = [sheetRecipe('/first.css'), sheetRecipe('/second.css')];
  const {controller} = harness('auto', new FakeDetector(
    result('light'), result('light'), result('light'), result('light'),
  ), async () => {}, official);
  const starting = controller.start();
  await until(() => official.waits.length === 1);
  official.waits[0]!.resolve();
  await until(() => official.waits.length === 2);
  await controller.update(config('off'));
  expect(official.applied).toBe(false);
  expect(official.signals[1]?.aborted).toBe(true);
  official.waits[1]!.resolve();
  await starting;
  expect(controller.getStatus().decision).toBe('user-off');
  controller.stop();
});

it('re-probes changed candidates after an async failure instead of activating a stale variant', async () => {
  const official = new WaitingOfficial();
  const first = sheetRecipe('/first.css');
  const stale = sheetRecipe('/stale.css');
  const replacement = sheetRecipe('/replacement.css');
  official.recipes = [first, stale];
  const {controller} = harness('auto', new FakeDetector(
    result('light'), result('light'), result('light'), result('light'), result('light'), result('native-dark'),
  ), async () => {}, official);
  const starting = controller.start();
  await until(() => official.waits.length === 1);
  official.recipes = [replacement];
  official.waits[0]!.resolve();
  await starting;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await until(() => official.waits.length === 2);
  expect(official.attempted).toEqual([[first], [replacement]]);
  official.waits[1]!.resolve();
  await until(() => controller.getStatus().decision === 'official-dark');
  controller.stop();
});

it.each(['html', 'body'] as const)('gives a replacement %s a fresh budget for the same recipe', async (target) => {
  const official = new FakeOfficial();
  official.recipes = [{type: 'attribute', target, name: 'data-theme', value: 'dark'}];
  const detector = new FakeDetector(...Array.from({length: 12}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  await controller.recheck();
  await controller.recheck();
  expect(official.activates).toBe(2);
  const old = target === 'html' ? document.documentElement : document.body;
  const replacement = old.cloneNode(true) as HTMLElement;
  old.replaceWith(replacement);
  try {
    detector.samples.push(result('light'), result('light'), result('native-dark'));
    await controller.recheck();
    expect(official.activates).toBe(3);
    expect(controller.getStatus().decision).toBe('official-dark');
  } finally {
    controller.stop();
    replacement.replaceWith(old);
  }
});

it('resets the budget when a root attribute source state changes without changing its requested value', async () => {
  document.documentElement.setAttribute('data-theme', 'light');
  const official = new FakeOfficial();
  const detector = new FakeDetector(...Array.from({length: 12}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  try {
    await controller.start();
    await controller.recheck();
    await controller.recheck();
    expect(official.activates).toBe(2);
    document.documentElement.setAttribute('data-theme', 'system');
    detector.samples.push(result('light'), result('light'), result('native-dark'));
    await controller.recheck();
    expect(official.activates).toBe(3);
    expect(controller.getStatus().decision).toBe('official-dark');
  } finally {
    controller.stop();
    document.documentElement.removeAttribute('data-theme');
  }
});

it.each(['observer', 'cssom', 'mode-change'] as const)('retries unchanged recipes after %s invalidates old style evidence', async (source) => {
  const official = new FakeOfficial();
  const detector = new FakeDetector(...Array.from({length: 12}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  await controller.recheck();
  await controller.recheck();
  expect(official.activates).toBe(2);
  detector.samples.push(result('light'), result('light'), result('native-dark'));
  if (source === 'observer') {
    detector.emit(true);
    await until(() => controller.getStatus().decision === 'official-dark');
  } else if (source === 'cssom') {
    await controller.recheck(true);
  } else {
    await controller.update(config('off'));
    await controller.update(config('auto'));
  }
  expect(official.activates).toBe(3);
  expect(controller.getStatus().decision).toBe('official-dark');
  controller.stop();
});

it('rechecks late owned stylesheet loads without resetting their exhausted budget', async () => {
  const official = new FakeOfficial();
  const recipe = sheetRecipe('/slow-inert.css');
  official.recipes = [recipe];
  const detector = new FakeDetector(...Array.from({length: 14}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  await controller.recheck();
  await controller.recheck();
  expect(official.activates).toBe(2);
  detector.emit(true, recipe.link);
  await until(() => controller.getStatus().decision === 'applied-light');
  expect(official.activates).toBe(2);
  detector.samples.push(result('light'), result('light'), result('native-dark'));
  detector.emit(true, document.createElement('link'));
  await until(() => controller.getStatus().decision === 'official-dark');
  expect(official.activates).toBe(3);
  controller.stop();
});

it('lets pending confirmation absorb CSSOM changes without restart loops', async () => {
  const official = new WaitingOfficial();
  const {controller} = harness('auto', new FakeDetector(
    result('light'), result('light'), result('native-dark'),
  ), async () => {}, official);
  const starting = controller.start();
  await until(() => official.waits.length === 1);
  await controller.recheck(true);
  expect(official.activates).toBe(1);
  expect(official.restores).toBe(0);
  official.waits[0]!.resolve();
  await starting;
  expect(controller.getStatus().decision).toBe('official-dark');
  controller.stop();
});

it('treats a new body as fresh evidence even for an html-owned recipe', async () => {
  const official = new FakeOfficial();
  const detector = new FakeDetector(...Array.from({length: 12}, () => result('light')));
  const {controller} = harness('auto', detector, async () => {}, official);
  await controller.start();
  await controller.recheck();
  await controller.recheck();
  expect(official.activates).toBe(2);
  const old = document.body;
  const replacement = document.createElement('body');
  old.replaceWith(replacement);
  try {
    detector.samples.push(result('light'), result('light'), result('native-dark'));
    await controller.recheck();
    expect(official.activates).toBe(3);
    expect(controller.getStatus().decision).toBe('official-dark');
  } finally {
    controller.stop(); replacement.replaceWith(old);
  }
});
