import {
  compositeSrgb,
  contrastRatio,
  parseCssColor,
  relativeLuminance,
  srgb,
  type SrgbColor,
} from '../color/index';
import {AuthoredThemeObserver} from './authored-theme-observer';

const DARK_LUMINANCE = 0.18;
const LIGHT_LUMINANCE = 0.55;
const GRID = [0.1, 0.5, 0.9] as const;
const MEDIA_SELECTOR = 'img,video,canvas,svg,iframe,object,embed';
const DARK_CLASSES = new Set(['dark', 'dark-mode', 'theme-dark', 'is-dark']);
const THEME_ATTRIBUTES = [
  'data-theme',
  'data-bs-theme',
  'data-color-mode',
  'data-color-theme',
  'data-mode',
  'data-dark-mode',
] as const;

export type NativeThemeKind = 'native-dark' | 'light' | 'ambiguous' | 'forced-colors';

export interface NativeThemeEvidence {
  forcedColors: boolean;
  negotiatedDark: boolean;
  rootDarkMarker: boolean;
  knownSamples: number;
  darkCoverage: number;
  lightCoverage: number;
  lightOnDarkCoherence: number;
  darkOnLightCoherence: number;
}

export interface NativeThemeDecision {
  kind: NativeThemeKind;
  reason: string;
  evidence: NativeThemeEvidence;
}

export interface NativeThemeDetectorLike {
  sample(): NativeThemeDecision;
  start(onChange: () => void): void;
  stop(): void;
}

export function classifyNativeTheme(evidence: NativeThemeEvidence): NativeThemeDecision {
  const strongDark = evidence.knownSamples >= 5 && (
    (evidence.darkCoverage >= 0.65 && evidence.lightOnDarkCoherence >= 0.55) ||
    evidence.darkCoverage >= 0.78
  );
  const strongLight = evidence.knownSamples >= 5 &&
    evidence.lightCoverage >= 0.7 &&
    evidence.darkCoverage <= 0.2 &&
    evidence.darkOnLightCoherence >= 0.55;

  if (evidence.forcedColors) return decision('forced-colors', 'forced-colors-active', evidence);
  if (strongDark) return decision('native-dark', 'dark-rendered-surfaces', evidence);
  if (evidence.rootDarkMarker) {
    return strongLight
      ? decision('ambiguous', 'dark-marker-conflicts-with-light-rendering', evidence)
      : decision('native-dark', 'active-root-dark-marker', evidence);
  }
  if (evidence.negotiatedDark && !strongLight && (
    evidence.darkCoverage >= 0.4 || evidence.knownSamples === 0
  )) {
    return decision('native-dark', 'dark-color-scheme-without-light-conflict', evidence);
  }
  if (strongLight) return decision('light', 'light-rendered-surfaces', evidence);
  return decision('ambiguous', 'insufficient-stable-theme-evidence', evidence);
}

export class NativeDarkDetector implements NativeThemeDetectorLike {
  private authoredThemeObserver: AuthoredThemeObserver | null = null;
  private darkPreference: MediaQueryList | null = null;
  private forcedColors: MediaQueryList | null = null;
  private onChange: (() => void) | null = null;

  private readonly notify = (): void => { this.onChange?.(); };
  private readonly notifyWhenVisible = (): void => {
    if (document.visibilityState === 'visible') this.notify();
  };

  sample(): NativeThemeDecision {
    const forcedColors = mediaMatches('(forced-colors: active)');
    const prefersDark = mediaMatches('(prefers-color-scheme: dark)');
    const negotiatedDark = selectedSchemeIsDark(prefersDark);
    const visual = sampleViewport(negotiatedDark);
    return classifyNativeTheme({
      forcedColors,
      negotiatedDark,
      rootDarkMarker: hasRootDarkMarker(),
      ...visual,
    });
  }

  start(onChange: () => void): void {
    this.stop();
    this.onChange = onChange;
    this.darkPreference = safeMatchMedia('(prefers-color-scheme: dark)');
    this.forcedColors = safeMatchMedia('(forced-colors: active)');
    this.darkPreference?.addEventListener('change', this.notify);
    this.forcedColors?.addEventListener('change', this.notify);

    this.authoredThemeObserver = new AuthoredThemeObserver(this.notify);
    this.authoredThemeObserver.start();
    document.addEventListener('visibilitychange', this.notifyWhenVisible);
    window.addEventListener('pageshow', this.notify);
  }

  stop(): void {
    this.authoredThemeObserver?.stop();
    this.authoredThemeObserver = null;
    this.darkPreference?.removeEventListener('change', this.notify);
    this.forcedColors?.removeEventListener('change', this.notify);
    this.darkPreference = null;
    this.forcedColors = null;
    document.removeEventListener('visibilitychange', this.notifyWhenVisible);
    window.removeEventListener('pageshow', this.notify);
    this.onChange = null;
  }
}

function decision(
  kind: NativeThemeKind,
  reason: string,
  evidence: NativeThemeEvidence,
): NativeThemeDecision {
  return {kind, reason, evidence};
}

function sampleViewport(negotiatedDark: boolean): Omit<NativeThemeEvidence,
  'forcedColors' | 'negotiatedDark' | 'rootDarkMarker'> {
  const width = Math.max(document.documentElement.clientWidth, window.innerWidth);
  const height = Math.max(document.documentElement.clientHeight, window.innerHeight);
  const canvas = negotiatedDark ? srgb(18 / 255, 18 / 255, 18 / 255) : srgb(1, 1, 1);
  let known = 0;
  let dark = 0;
  let light = 0;
  let coherentDark = 0;
  let coherentLight = 0;

  if (width > 0 && height > 0 && typeof document.elementsFromPoint === 'function') {
    for (const xRatio of GRID) for (const yRatio of GRID) {
      const element = document.elementsFromPoint(width * xRatio, height * yRatio)
        .find((candidate) => !isExtensionElement(candidate));
      if (!element || element.closest(MEDIA_SELECTOR)) continue;
      const sample = sampleElement(element, canvas);
      if (!sample) continue;
      known += 1;
      const backgroundLuminance = relativeLuminance(sample.background);
      const foregroundLuminance = relativeLuminance(sample.foreground);
      if (backgroundLuminance <= DARK_LUMINANCE) {
        dark += 1;
        if (foregroundLuminance > backgroundLuminance &&
          contrastRatio(sample.foreground, sample.background) >= 3) coherentDark += 1;
      } else if (backgroundLuminance >= LIGHT_LUMINANCE) {
        light += 1;
        if (foregroundLuminance < backgroundLuminance &&
          contrastRatio(sample.foreground, sample.background) >= 3) coherentLight += 1;
      }
    }
  }

  return {
    knownSamples: known,
    darkCoverage: known === 0 ? 0 : dark / known,
    lightCoverage: known === 0 ? 0 : light / known,
    lightOnDarkCoherence: dark === 0 ? 0 : coherentDark / dark,
    darkOnLightCoherence: light === 0 ? 0 : coherentLight / light,
  };
}

function sampleElement(element: Element, canvas: SrgbColor): {
  background: SrgbColor;
  foreground: SrgbColor;
} | null {
  const layers: SrgbColor[] = [];
  let current: Element | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (style.backgroundImage !== 'none') return null;
    const color = parseCssColor(style.backgroundColor);
    if (color && color.a > 0) layers.push(color);
    current = current.parentElement;
  }
  let background = canvas;
  for (const layer of layers.reverse()) background = compositeSrgb(layer, background);
  const foreground = parseCssColor(getComputedStyle(element).color);
  return foreground ? {background, foreground} : null;
}

function selectedSchemeIsDark(prefersDark: boolean): boolean {
  const computed = getComputedStyle(document.documentElement).colorScheme.trim().toLowerCase();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme" i]')
    ?.content.trim().toLowerCase() ?? '';
  return schemeValueSelectsDark(computed === 'normal' ? meta : computed, prefersDark);
}

function schemeValueSelectsDark(value: string, prefersDark: boolean): boolean {
  const tokens = value.split(/\s+/).filter((token) => token && token !== 'only');
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  return dark && (!light || prefersDark);
}

function hasRootDarkMarker(): boolean {
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    if ([...element.classList].some((token) => DARK_CLASSES.has(token.toLowerCase()))) return true;
    for (const attribute of THEME_ATTRIBUTES) {
      const tokens = (element.getAttribute(attribute) ?? '').toLowerCase().split(/[\s_:.-]+/);
      if (tokens.includes('dark')) return true;
    }
  }
  return false;
}

function safeMatchMedia(query: string): MediaQueryList | null {
  try { return typeof matchMedia === 'function' ? matchMedia(query) : null; } catch { return null; }
}

function mediaMatches(query: string): boolean {
  return safeMatchMedia(query)?.matches ?? false;
}

function isExtensionElement(element: Element): boolean {
  return element.matches('[data-semantic-dark-sheet],[data-semantic-dark-ui]') ||
    element.closest('[data-semantic-dark-ui]') !== null;
}
