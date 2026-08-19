import {describe, expect, it} from 'vitest';
import {srgb} from '../../src/color/index';
import {
  NativeDarkDetector,
  backgroundImageBlocksSample,
  canvasLooksLight,
  classifyNativeTheme,
  isLikelyViewportOverlay,
  type NativeThemeEvidence,
} from '../../src/content/native-dark';

const BASE: NativeThemeEvidence = {
  forcedColors: false,
  negotiatedDark: false,
  declaredLight: false,
  lightCanvas: false,
  visibleContent: true,
  rootDarkMarker: false,
  knownSamples: 9,
  darkCoverage: 0,
  lightCoverage: 0,
  lightOnDarkCoherence: 0,
  darkOnLightCoherence: 0,
};

function evidence(overrides: Partial<NativeThemeEvidence>): NativeThemeEvidence {
  return {...BASE, ...overrides};
}

describe('native theme classification', () => {
  it('protects a coherently rendered dark page without requiring metadata', () => {
    const result = classifyNativeTheme(evidence({
      darkCoverage: 0.78,
      lightOnDarkCoherence: 0.72,
    }));
    expect(result.kind).toBe('native-dark');
    expect(result.reason).toBe('dark-rendered-surfaces');
  });

  it('recognizes an explicit light scheme with sparse safe samples', () => {
    const result = classifyNativeTheme(evidence({
      declaredLight: true,
      lightCanvas: true,
      knownSamples: 0,
    }));
    expect(result.kind).toBe('light');
    expect(result.reason).toBe('explicit-light-scheme');
  });

  it('lets strong light rendering override a negotiated dark declaration', () => {
    const result = classifyNativeTheme(evidence({
      negotiatedDark: true,
      lightCoverage: 0.89,
      darkOnLightCoherence: 0.88,
    }));
    expect(result.kind).toBe('light');
  });

  it('accepts a dark scheme with a transparent canvas and no contradiction', () => {
    const result = classifyNativeTheme(evidence({
      negotiatedDark: true,
      knownSamples: 0,
    }));
    expect(result.kind).toBe('native-dark');
  });

  it('fails closed when a root dark marker conflicts with light rendering', () => {
    const result = classifyNativeTheme(evidence({
      rootDarkMarker: true,
      lightCoverage: 0.8,
      darkOnLightCoherence: 0.75,
    }));
    expect(result.kind).toBe('ambiguous');
  });

  it('fails closed when there is no visible page content', () => {
    const result = classifyNativeTheme(evidence({
      declaredLight: true,
      lightCanvas: true,
      visibleContent: false,
      knownSamples: 0,
    }));
    expect(result.kind).toBe('ambiguous');
    expect(result.reason).toBe('insufficient-stable-theme-evidence');
  });

  it('accepts four consistent light samples without weakening the dark-page gate', () => {
    const result = classifyNativeTheme(evidence({
      knownSamples: 4,
      lightCoverage: 1,
      darkOnLightCoherence: 1,
    }));
    expect(result.kind).toBe('light');
  });

  it('activates an undeclared light canvas once two coherent samples exist', () => {
    const result = classifyNativeTheme(evidence({
      lightCanvas: true,
      knownSamples: 2,
      lightCoverage: 1,
      darkCoverage: 0,
      darkOnLightCoherence: 1,
    }));
    expect(result.kind).toBe('light');
    expect(result.reason).toBe('light-canvas-without-dark-conflict');
  });

  it('does not treat a blank undeclared canvas as light', () => {
    const result = classifyNativeTheme(evidence({
      lightCanvas: true,
      knownSamples: 0,
    }));
    expect(result.kind).toBe('ambiguous');
  });

  it('keeps mixed light/dark canvases fail-closed without a color-scheme declaration', () => {
    const result = classifyNativeTheme(evidence({
      lightCanvas: true,
      knownSamples: 6,
      lightCoverage: 0.5,
      darkCoverage: 0.5,
      darkOnLightCoherence: 1,
      lightOnDarkCoherence: 1,
    }));
    expect(result.kind).toBe('ambiguous');
  });

  it('does not let an implicit light canvas override a negotiated dark scheme', () => {
    const result = classifyNativeTheme(evidence({
      negotiatedDark: true,
      lightCanvas: true,
      knownSamples: 3,
      lightCoverage: 0.67,
      darkCoverage: 0.33,
    }));
    expect(result.kind).not.toBe('light');
    expect(result.kind).toBe('ambiguous');
  });

  it('does not mistake a dark hero on a mostly light page for native dark', () => {
    const result = classifyNativeTheme(evidence({
      darkCoverage: 0.3,
      lightCoverage: 0.7,
      lightOnDarkCoherence: 1,
      darkOnLightCoherence: 1,
    }));
    expect(result.kind).toBe('ambiguous');
  });

  it('never transforms a forced-colors page', () => {
    const result = classifyNativeTheme(evidence({
      forcedColors: true,
      lightCoverage: 1,
      darkOnLightCoherence: 1,
    }));
    expect(result.kind).toBe('forced-colors');
  });

  it('ignores extension-owned inline variables but observes authored root styles', async () => {
    const detector = new NativeDarkDetector();
    let changes = 0;
    detector.start(() => { changes += 1; });
    document.documentElement.style.setProperty('--semantic-dark-background', '#111');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toBe(0);

    document.documentElement.style.backgroundColor = 'white';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toBe(1);
    detector.stop();
    document.documentElement.removeAttribute('style');
  });

  it('samples CSS gradients but still abstains on bitmap backgrounds', () => {
    expect(backgroundImageBlocksSample('none')).toBe(false);
    expect(backgroundImageBlocksSample('linear-gradient(white, #eee)')).toBe(false);
    expect(backgroundImageBlocksSample('url("https://example.com/hero.jpg")')).toBe(true);
    expect(backgroundImageBlocksSample('linear-gradient(white, #eee), url(hero.png)')).toBe(true);
  });

  it('treats a transparent root as the UA light canvas unless dark was negotiated', () => {
    expect(canvasLooksLight(srgb(0, 0, 0, 0), srgb(0, 0, 0, 0), false)).toBe(true);
    expect(canvasLooksLight(srgb(0, 0, 0, 0), srgb(0, 0, 0, 0), true)).toBe(false);
    expect(canvasLooksLight(srgb(1, 1, 1), null, true)).toBe(true);
    expect(canvasLooksLight(srgb(18 / 255, 18 / 255, 18 / 255), null, false)).toBe(false);
  });

  it('ignores full-viewport cookie banners when locating theme samples', () => {
    expect(isLikelyViewportOverlay({
      width: 1440,
      height: 420,
      viewportWidth: 1440,
      viewportHeight: 900,
      position: 'fixed',
      zIndex: '9999',
      role: 'dialog',
      tagName: 'DIV',
    })).toBe(true);
    expect(isLikelyViewportOverlay({
      width: 320,
      height: 48,
      viewportWidth: 1440,
      viewportHeight: 900,
      position: 'fixed',
      zIndex: '20',
      role: null,
      tagName: 'HEADER',
    })).toBe(false);
  });

  it('attaches to a body that appears after document-start initialization', async () => {
    const originalBody = document.body;
    originalBody.remove();
    const detector = new NativeDarkDetector();
    let changes = 0;
    detector.start(() => { changes += 1; });

    const lateBody = document.createElement('body');
    document.documentElement.append(lateBody);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterAttach = changes;
    lateBody.classList.add('dark');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(changes).toBeGreaterThan(afterAttach);
    detector.stop();
    lateBody.replaceWith(originalBody);
  });
});
