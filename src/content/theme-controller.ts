import {
  normalizeThemeConfig,
  type NormalizedThemeConfig,
  type PageThemeStatus,
  type ThemeConfig,
} from '../types';
import type {NativeThemeDecision, NativeThemeDetectorLike} from './native-dark';
import {beginDocumentTransitionGuard, endDocumentTransitionGuard, flushDocumentStyle}
  from './dom-style-contract';
import {OfficialThemeLane, officialThemeLooksApplied, type OfficialThemeLaneLike} from './official-theme';
import {officialThemeCandidates, officialThemeRecipeKeys} from './official-theme-recipes';
const ACTIVE_ATTRIBUTE = 'data-semantic-dark-active';
const MAX_OFFICIAL_ATTEMPTS = 2;

export interface ThemeEngineLike {
  update(config: ThemeConfig): void;
  rescan?(): void;
}

export interface ThemeEngineSet {
  dom: ThemeEngineLike;
  svg: ThemeEngineLike;
  image: ThemeEngineLike;
}

export interface ThemeControllerOptions {
  settle?: () => Promise<void>;
  stableDelay?: () => Promise<void>;
  debounceMs?: number;
  onStatus?: (status: PageThemeStatus) => void;
  officialTheme?: OfficialThemeLaneLike;
}

export class ThemeController {
  private config: NormalizedThemeConfig;
  private readonly settle: () => Promise<void>;
  private readonly stableDelay: () => Promise<void>;
  private readonly debounceMs: number;
  private readonly onStatus: ((status: PageThemeStatus) => void) | undefined;
  private active = false;
  private started = false;
  private detectorRunning = false;
  private generation = 0;
  private probeAbort: AbortController | null = null;
  private pendingOfficialGeneration: number | null = null;
  private timer: number | null = null;
  private status: PageThemeStatus;
  private readonly officialTheme: OfficialThemeLaneLike;
  private officialFailures = 0;
  private officialRecipeKeys: Array<string | Element> = [];
  private officialStylesheetLoads = new WeakSet<Element>();

  constructor(
    config: ThemeConfig,
    private readonly detector: NativeThemeDetectorLike,
    private readonly engines: ThemeEngineSet,
    options: ThemeControllerOptions = {},
  ) {
    this.config = normalizeThemeConfig(config);
    this.settle = options.settle ?? settleDocument;
    this.stableDelay = options.stableDelay ?? (() => delay(120));
    this.debounceMs = options.debounceMs ?? 100;
    this.onStatus = options.onStatus;
    this.officialTheme = options.officialTheme ?? new OfficialThemeLane();
    this.status = {
      mode: this.config.mode,
      effectiveEnabled: false,
      decision: 'pending',
      reason: 'awaiting-source-theme-probe',
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reconcile(true);
  }

  async update(config: ThemeConfig): Promise<void> {
    const previousMode = this.config.mode;
    this.config = normalizeThemeConfig(config);
    if (previousMode !== this.config.mode && this.config.mode === 'auto') this.officialFailures = 0;
    const interrupted = this.probeAbort !== null || this.timer !== null;
    this.cancelPendingProbe();
    if (!this.started) return;
    await this.reconcile(previousMode !== this.config.mode || interrupted);
  }

  async recheck(stylesChanged = false): Promise<void> {
    if (stylesChanged && this.pendingOfficialGeneration !== null) return;
    if (stylesChanged) this.officialFailures = 0;
    if (!this.started || this.config.mode !== 'auto') return;
    if (this.pauseForSystemLight()) return;
    await this.probe();
  }

  getStatus(): PageThemeStatus {
    return {...this.status};
  }

  rescan(): void {
    if (!this.active) return;
    this.engines.dom.rescan?.();
    this.engines.svg.rescan?.();
  }

  stop(): void {
    this.started = false;
    this.cancelPendingProbe();
    this.stopDetector();
    this.deactivate();
    this.releaseOfficialTheme();
    this.officialFailures = 0;
    this.officialRecipeKeys = [];
    this.officialStylesheetLoads = new WeakSet();
  }

  private async reconcile(modeChanged: boolean): Promise<void> {
    if (this.config.mode === 'off') {
      this.stopDetector();
      this.deactivate();
      this.releaseOfficialTheme();
      this.setStatus('user-off', 'disabled-by-user');
      return;
    }
    if (this.config.mode === 'on') {
      this.stopDetector();
      this.releaseOfficialTheme();
      if (this.active) this.applyToEngines(true);
      this.activate();
      this.setStatus('user-on', 'forced-on-by-user');
      return;
    }

    this.startDetector();
    if (this.pauseForSystemLight()) return;
    if (this.active) this.applyToEngines(true);
    if (modeChanged || this.status.decision === 'pending' || this.status.decision === 'system-light') {
      await this.probe();
    }
  }

  private startDetector(): void {
    if (this.detectorRunning) return;
    this.detector.start((stylesChanged, loadedStylesheet) =>
      this.handleDetectorChange(stylesChanged, loadedStylesheet));
    this.detectorRunning = true;
  }

  private stopDetector(): void {
    if (!this.detectorRunning) return;
    this.detector.stop();
    this.detectorRunning = false;
  }

  private handleDetectorChange(stylesChanged = false, loadedStylesheet?: Element): void {
    if (!this.started || this.config.mode !== 'auto') return;
    // A late load of our own failed CSS may recheck, but must not renew its budget.
    if (stylesChanged && this.pendingOfficialGeneration === null &&
      (!loadedStylesheet || !this.officialStylesheetLoads.has(loadedStylesheet))) {
      this.officialFailures = 0;
    }
    if (this.pauseForSystemLight()) return;
    // The in-flight confirmation will sample these changes after CSS settles.
    // Restarting on its own stylesheet load would roll back and re-enable it.
    if (this.pendingOfficialGeneration !== null) return;
    this.cancelPendingProbe();
    if (this.active) {
      void this.probe();
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.probe();
    }, this.debounceMs);
  }

  private pauseForSystemLight(): boolean {
    if (this.detector.prefersDark()) return false;
    this.cancelPendingProbe();
    this.deactivate();
    this.releaseOfficialTheme();
    this.setStatus('system-light', 'system-prefers-light');
    return true;
  }

  private async probe(): Promise<void> {
    this.cancelPendingProbe();
    const generation = this.generation;
    const abort = new AbortController();
    this.probeAbort = abort;
    this.setStatus('pending', 'probing-authored-theme');
    try {
      await this.settle();
      if (!this.isCurrentProbe(generation)) return;
      let result = await this.sampleStableTheme(generation);
      if (!this.isCurrentProbe(generation)) return;
      if (this.officialTheme.isApplied() && !officialThemeLooksApplied(result)) {
        this.releaseOfficialTheme();
        this.officialFailures += 1;
        result = await this.sampleStableTheme(generation);
      }
      if (!this.isCurrentProbe(generation)) return;
      if (result.kind === 'light') {
        const official = await this.preferOfficialTheme(generation, abort.signal);
        if (!this.isCurrentProbe(generation)) return;
        if (official === 'applied') return;
        // Rollback may expose new site/SPA state. Never apply an old light result.
        if (official === 'failed') result = await this.sampleStableTheme(generation);
      }
      if (this.isCurrentProbe(generation)) this.applyDecision(result);
    } catch {
      if (this.isCurrentProbe(generation)) {
        this.releaseOfficialTheme();
        this.deactivate();
        this.setStatus('ambiguous', 'source-theme-probe-failed');
      }
    } finally {
      if (this.probeAbort === abort) this.probeAbort = null;
    }
  }

  private async sampleStableTheme(generation: number): Promise<NativeThemeDecision> {
    const result = this.sampleAuthoredTheme();
    if (result.kind !== 'light') return result;
    await this.stableDelay();
    return this.isCurrentProbe(generation) ? this.sampleAuthoredTheme() : result;
  }

  private applyDecision(result: NativeThemeDecision): void {
    if (result.kind === 'light') {
      this.releaseOfficialTheme();
      this.activate();
      this.setStatus('applied-light', result.reason);
      return;
    }
    this.deactivate();
    if (result.kind === 'native-dark') {
      this.setStatus(this.officialTheme.isApplied() ? 'official-dark' : 'native-dark',
        this.officialTheme.isApplied() ? 'official-theme-activated' : result.reason);
      return;
    }
    this.releaseOfficialTheme();
    if (result.kind === 'forced-colors') this.setStatus('forced-colors', result.reason);
    else this.setStatus('ambiguous', result.reason);
  }

  private async preferOfficialTheme(
    generation: number,
    signal: AbortSignal,
  ): Promise<'unavailable' | 'applied' | 'failed'> {
    const probe = this.officialTheme.probe();
    const keys = officialThemeRecipeKeys(probe);
    if (!this.sameOfficialRecipes(keys)) {
      this.officialFailures = 0;
      this.officialRecipeKeys = keys;
    }
    if (this.officialFailures >= MAX_OFFICIAL_ATTEMPTS || !probe.capable) return 'unavailable';
    this.deactivate();
    const candidates = officialThemeCandidates(probe);
    for (const [index, recipes] of candidates.entries()) {
      // The previous candidate may have overlapped a site/SPA theme change.
      if (index > 0 && this.sampleAuthoredTheme().kind !== 'light') return 'failed';
      this.pendingOfficialGeneration = generation;
      for (const recipe of recipes) {
        if (recipe.type === 'stylesheet') this.officialStylesheetLoads.add(recipe.link);
      }
      this.mutateAuthoredTheme(() => this.officialTheme.activate(recipes));
      if (!this.officialTheme.isApplied()) {
        this.pendingOfficialGeneration = null;
        continue;
      }
      await this.officialTheme.settle?.(signal);
      if (!this.isCurrentProbe(generation)) return 'failed';
      flushDocumentStyle(document.documentElement);
      await this.stableDelay();
      if (!this.isCurrentProbe(generation)) return 'failed';
      const after = this.sampleAuthoredTheme();
      if (officialThemeLooksApplied(after)) {
        this.officialFailures = 0;
        this.pendingOfficialGeneration = null;
        this.setStatus('official-dark', 'official-theme-activated');
        return 'applied';
      }
      this.releaseOfficialTheme();
      if (!this.sameOfficialRecipes(officialThemeRecipeKeys(this.officialTheme.probe()))) {
        // Re-probe a changed SPA contract instead of applying a stale candidate.
        this.handleDetectorChange();
        return 'failed';
      }
    }
    this.officialFailures += 1;
    return 'failed';
  }

  private sameOfficialRecipes(keys: readonly (string | Element)[]): boolean {
    return keys.length === this.officialRecipeKeys.length &&
      keys.every((key, index) => key === this.officialRecipeKeys[index]);
  }

  private releaseOfficialTheme(): void {
    this.pendingOfficialGeneration = null;
    if (this.officialTheme.isApplied()) {
      this.mutateAuthoredTheme(() => this.officialTheme.restore());
    }
  }

  private mutateAuthoredTheme(run: () => void): void {
    if (this.detector.withSuppressedAuthoredChanges) {
      this.detector.withSuppressedAuthoredChanges(run);
      return;
    }
    run();
  }

  private activate(): void {
    if (this.active) {
      document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, '');
      return;
    }
    const root = document.documentElement;
    beginDocumentTransitionGuard(root);
    try {
      root.setAttribute(ACTIVE_ATTRIBUTE, '');
      flushDocumentStyle(root);
      this.active = true;
      this.applyToEngines(true);
    } finally {
      endDocumentTransitionGuard(root);
    }
  }

  private deactivate(): void {
    const root = document.documentElement;
    if (!this.active) {
      root.removeAttribute(ACTIVE_ATTRIBUTE);
      return;
    }
    beginDocumentTransitionGuard(root);
    try {
      this.applyToEngines(false);
      this.active = false;
      root.removeAttribute(ACTIVE_ATTRIBUTE);
      flushDocumentStyle(root);
    } finally {
      endDocumentTransitionGuard(root);
    }
  }

  private applyToEngines(enabled: boolean): void {
    const effective: ThemeConfig = {...this.config, enabled};
    const ordered = enabled
      ? [this.engines.dom, this.engines.svg, this.engines.image]
      : [this.engines.image, this.engines.svg, this.engines.dom];
    for (const engine of ordered) engine.update(effective);
  }

  private setStatus(decision: PageThemeStatus['decision'], reason: string): void {
    this.status = {
      mode: this.config.mode,
      effectiveEnabled: this.active,
      decision,
      reason,
    };
    this.onStatus?.({...this.status});
  }

  private sampleAuthoredTheme(): NativeThemeDecision {
    const root = document.documentElement;
    if (!this.active && root.hasAttribute(ACTIVE_ATTRIBUTE)) {
      throw new Error('Inactive theme controller retained its active marker');
    }

    beginDocumentTransitionGuard(root);
    if (this.active) root.removeAttribute(ACTIVE_ATTRIBUTE);
    flushDocumentStyle(root);
    try {
      return this.detector.sample();
    } finally {
      if (this.active) root.setAttribute(ACTIVE_ATTRIBUTE, '');
      endDocumentTransitionGuard(root);
    }
  }

  private isCurrentProbe(generation: number): boolean {
    return this.started && this.config.mode === 'auto' &&
      this.detector.prefersDark() && generation === this.generation;
  }

  private cancelPendingProbe(): void {
    this.generation += 1;
    this.probeAbort?.abort();
    this.probeAbort = null;
    if (this.pendingOfficialGeneration !== null) this.releaseOfficialTheme();
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

async function settleDocument(): Promise<void> {
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve(), {once: true});
    });
  }
  await nextFrame();
  await nextFrame();
  await delay(80);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
