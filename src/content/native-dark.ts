import {
  compositeSrgb,
  contrastRatio,
  parseCssColor,
  relativeLuminance,
  srgb,
  type SrgbColor,
} from '../color/index';
import {AuthoredThemeObserver} from './authored-theme-observer';
import {
  DARK_LUMINANCE,
  LIGHT_LUMINANCE,
  backgroundImageBlocksSample,
  canvasLooksLight,
  classifyNativeTheme,
  isLikelyViewportOverlay,
  type NativeThemeDecision,
  type NativeThemeEvidence,
  type NativeThemeKind,
} from './native-theme-evidence';
import {isDarkClassToken, THEME_ATTRIBUTES} from './theme-markers';

export {
  classifyNativeTheme,
  backgroundImageBlocksSample,
  canvasLooksLight,
  isLikelyViewportOverlay,
  type NativeThemeDecision,
  type NativeThemeEvidence,
  type NativeThemeKind,
};

const GRID = [0.1, 0.5, 0.9] as const;
const MEDIA_SELECTOR = 'img,video,canvas,svg,iframe,object,embed';

export interface NativeThemeDetectorLike {
  prefersDark(): boolean;
  sample(): NativeThemeDecision;
  start(onChange: () => void): void;
  stop(): void;
  withSuppressedAuthoredChanges?(run: () => void): void;
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

  prefersDark(): boolean {
    return this.darkPreference?.matches ?? mediaMatches('(prefers-color-scheme: dark)');
  }

  sample(): NativeThemeDecision {
    const forcedColors = mediaMatches('(forced-colors: active)');
    const prefersDark = mediaMatches('(prefers-color-scheme: dark)');
    const negotiatedDark = selectedSchemeIsDark(prefersDark);
    const declaredLight = selectedSchemeIsLight(prefersDark);
    const visual = sampleViewport(negotiatedDark);
    return classifyNativeTheme({
      forcedColors,
      negotiatedDark,
      ...visual,
      declaredLight,
      lightCanvas: hasLightCanvas(negotiatedDark),
      visibleContent: hasVisibleContent(),
      rootDarkMarker: hasRootDarkMarker(),
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

  withSuppressedAuthoredChanges(run: () => void): void {
    this.authoredThemeObserver?.suspend();
    try {
      run();
    } finally {
      this.authoredThemeObserver?.resume();
    }
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

function sampleViewport(negotiatedDark: boolean): Omit<NativeThemeEvidence,
  'forcedColors' | 'negotiatedDark' | 'declaredLight' | 'lightCanvas' | 'visibleContent' | 'rootDarkMarker'> {
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
        .find((candidate) => isSampleableThemeElement(candidate, width, height));
      if (!element) continue;
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

function isSampleableThemeElement(
  element: Element,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (isExtensionElement(element) || element.closest(MEDIA_SELECTOR)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return !isLikelyViewportOverlay({
    width: rect.width,
    height: rect.height,
    viewportWidth,
    viewportHeight,
    position: style.position,
    zIndex: style.zIndex,
    role: element.getAttribute('role'),
    tagName: element.tagName,
  });
}

function sampleElement(element: Element, canvas: SrgbColor): {
  background: SrgbColor;
  foreground: SrgbColor;
} | null {
  const layers: SrgbColor[] = [];
  let current: Element | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (backgroundImageBlocksSample(style.backgroundImage)) return null;
    const color = parseCssColor(style.backgroundColor);
    if (color && color.a > 0) layers.push(color);
    current = current.parentElement;
  }
  let background = canvas;
  for (const layer of layers.reverse()) background = compositeSrgb(layer, background);
  const foreground = parseCssColor(getComputedStyle(element).color);
  return foreground ? {background, foreground} : null;
}

function hasVisibleContent(): boolean {
  const body = document.body;
  if (!body) return false;
  const candidates = body.querySelectorAll('*');
  for (const candidate of candidates) {
    if (isExtensionElement(candidate)) continue;
    if (candidate.matches('script,style,link,meta,noscript,template')) continue;
    const element = candidate as HTMLElement;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') continue;
    if ((element.textContent?.trim().length ?? 0) > 0 || candidate.matches(MEDIA_SELECTOR)) return true;
  }
  return false;
}

function hasLightCanvas(negotiatedDark: boolean): boolean {
  const paint = (element: Element | null): SrgbColor | null => {
    if (!element) return null;
    return parseCssColor(getComputedStyle(element).backgroundColor);
  };
  return canvasLooksLight(paint(document.body), paint(document.documentElement), negotiatedDark);
}

function selectedSchemeIsDark(prefersDark: boolean): boolean {
  return schemeValueSelectsDark(selectedSchemeValue(), prefersDark);
}

function selectedSchemeIsLight(prefersDark: boolean): boolean {
  return schemeValueSelectsLight(selectedSchemeValue(), prefersDark);
}

function selectedSchemeValue(): string {
  const computed = getComputedStyle(document.documentElement).colorScheme.trim().toLowerCase();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme" i]')
    ?.content.trim().toLowerCase() ?? '';
  return computed === 'normal' ? meta : computed;
}

function schemeValueSelectsDark(value: string, prefersDark: boolean): boolean {
  const tokens = value.split(/\s+/).filter((token) => token && token !== 'only');
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  return dark && (!light || prefersDark);
}

function schemeValueSelectsLight(value: string, prefersDark: boolean): boolean {
  const tokens = value.split(/\s+/).filter((token) => token && token !== 'only');
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  return light && (!dark || !prefersDark);
}

function hasRootDarkMarker(): boolean {
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    if ([...element.classList].some((token) => isDarkClassToken(token))) return true;
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
