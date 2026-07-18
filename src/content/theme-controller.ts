import {
  normalizeThemeConfig,
  type NormalizedThemeConfig,
  type PageThemeStatus,
  type ThemeConfig,
} from '../types';
import type {NativeThemeDecision, NativeThemeDetectorLike} from './native-dark';
import {beginDocumentTransitionGuard, endDocumentTransitionGuard, flushDocumentStyle}
  from './dom-style-contract';
const ACTIVE_ATTRIBUTE = 'data-semantic-dark-active';

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
  private timer: number | null = null;
  private status: PageThemeStatus;

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
    this.cancelPendingProbe();
    await this.reconcile(previousMode !== this.config.mode);
  }

  async recheck(): Promise<void> {
    if (!this.started || this.config.mode !== 'auto') return;
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
  }

  private async reconcile(modeChanged: boolean): Promise<void> {
    if (this.config.mode === 'off') {
      this.stopDetector();
      this.deactivate();
      this.setStatus('user-off', 'disabled-by-user');
      return;
    }
    if (this.config.mode === 'on') {
      this.stopDetector();
      this.activate();
      this.setStatus('user-on', 'forced-on-by-user');
      return;
    }

    this.startDetector();
    if (modeChanged || this.status.decision === 'pending') {
      await this.probe();
    } else if (this.active) {
      this.applyToEngines(true);
    }
  }

  private startDetector(): void {
    if (this.detectorRunning) return;
    this.detector.start(() => this.handleDetectorChange());
    this.detectorRunning = true;
  }

  private stopDetector(): void {
    if (!this.detectorRunning) return;
    this.detector.stop();
    this.detectorRunning = false;
  }

  private handleDetectorChange(): void {
    if (!this.started || this.config.mode !== 'auto') return;
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

  private async probe(): Promise<void> {
    const generation = ++this.generation;
    this.clearTimer();
    this.setStatus('pending', 'probing-authored-theme');
    try {
      await this.settle();
      if (!this.isCurrentProbe(generation)) return;
      let result = this.sampleAuthoredTheme();
      if (result.kind === 'light') {
        await this.stableDelay();
        if (!this.isCurrentProbe(generation)) return;
        const confirmation = this.sampleAuthoredTheme();
        result = confirmation.kind === 'light'
          ? confirmation
          : ambiguousConfirmation(result, confirmation);
      }
      if (!this.isCurrentProbe(generation)) return;
      this.applyDecision(result);
    } catch {
      if (this.isCurrentProbe(generation)) {
        this.deactivate();
        this.setStatus('ambiguous', 'source-theme-probe-failed');
      }
    }
  }

  private applyDecision(result: NativeThemeDecision): void {
    if (result.kind === 'light') {
      this.activate();
      this.setStatus('applied-light', result.reason);
      return;
    }
    this.deactivate();
    if (result.kind === 'native-dark') this.setStatus('native-dark', result.reason);
    else if (result.kind === 'forced-colors') this.setStatus('forced-colors', result.reason);
    else this.setStatus('ambiguous', result.reason);
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
    return this.started && this.config.mode === 'auto' && generation === this.generation;
  }

  private cancelPendingProbe(): void {
    this.generation += 1;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

function ambiguousConfirmation(
  first: NativeThemeDecision,
  second: NativeThemeDecision,
): NativeThemeDecision {
  if (second.kind !== 'light') return second;
  return {
    kind: 'ambiguous',
    reason: 'light-theme-probe-was-not-stable',
    evidence: first.evidence,
  };
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
