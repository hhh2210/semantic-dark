import {describe, expect, it} from 'vitest';
import {
  NativeDarkDetector,
  classifyNativeTheme,
  type NativeThemeEvidence,
} from '../../src/content/native-dark';

const BASE: NativeThemeEvidence = {
  forcedColors: false,
  negotiatedDark: false,
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
