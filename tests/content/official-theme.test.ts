import {afterEach, describe, expect, it} from 'vitest';
import {
  matchOfficialThemeSite,
  normalizeHostname,
} from '../../src/content/official-theme-catalog';
import {officialThemeLooksApplied} from '../../src/content/official-theme-recipes';
import {OfficialThemeLane, probeOfficialTheme} from '../../src/content/official-theme';
import type {NativeThemeDecision} from '../../src/content/native-dark';

afterEach(() => {
  const names = [
    'data-theme', 'data-color-mode', 'data-theme-mode', 'theme', 'lab-style', 'dark',
    'data-dark', 'data-dark-mode', 'class',
  ];
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    for (const name of names) element.removeAttribute(name);
  }
  document.querySelectorAll('link[data-official-theme-test]').forEach((node) => node.remove());
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-color-mode');
  document.documentElement.removeAttribute('class');
  document.body?.removeAttribute('class');
});

describe('official theme catalog', () => {
  it('matches Zhihu and Bilibili hosts without treating lookalike domains as official', () => {
    expect(matchOfficialThemeSite('www.zhihu.com')?.id).toBe('zhihu');
    expect(matchOfficialThemeSite('zhuanlan.zhihu.com')?.id).toBe('zhihu');
    expect(matchOfficialThemeSite('www.bilibili.com')?.id).toBe('bilibili');
    expect(matchOfficialThemeSite('live.bilibili.com')?.id).toBe('bilibili');
    expect(matchOfficialThemeSite('juejin.cn')?.id).toBe('juejin');
    expect(matchOfficialThemeSite('notzhihu.com')).toBeNull();
    expect(matchOfficialThemeSite('bilibili.example.com')).toBeNull();
    expect(normalizeHostname('WWW.Zhihu.COM:443')).toBe('www.zhihu.com');
  });
});

describe('official theme probe and restore', () => {
  it('flips a generic light theme attribute and restores the previous value', () => {
    document.documentElement.setAttribute('data-color-mode', 'light');
    const probe = probeOfficialTheme(document, 'example.com');
    expect(probe).toMatchObject({
      capable: true,
      source: 'theme-attribute',
      catalogId: null,
    });

    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('dark');
    lane.restore();
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('light');
    expect(lane.isApplied()).toBe(false);
  });

  it('activates Zhihu official dark via data-theme and restores an absent attribute', () => {
    const lane = new OfficialThemeLane({hostname: () => 'www.zhihu.com'});
    expect(lane.probe().catalogId).toBe('zhihu');
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    lane.restore();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('activates Bilibili official dark via root dark classes and restores them', () => {
    document.documentElement.className = 'app';
    document.body.className = 'main';
    const lane = new OfficialThemeLane({hostname: () => 'www.bilibili.com'});
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.body.classList.contains('dark')).toBe(true);
    lane.restore();
    expect(document.documentElement.className).toBe('app');
    expect(document.body.className).toBe('main');
  });

  it('does not invent an official switch on an ordinary light page', () => {
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.probe().capable).toBe(false);
    expect(lane.activate()).toBe(false);
  });

  it('swaps an explicit light class without adding dark to unrelated roots', () => {
    document.documentElement.className = 'theme-light wrapped';
    const lane = new OfficialThemeLane({hostname: () => 'docs.example.com'});
    expect(lane.probe().source).toBe('theme-class');
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    expect(document.documentElement.classList.contains('wrapped')).toBe(true);
    lane.restore();
    expect(document.documentElement.className).toBe('theme-light wrapped');
  });

  it('treats auto/system theme tokens and boolean dark=false as official switches', () => {
    document.documentElement.setAttribute('data-theme', 'auto');
    document.body?.setAttribute('dark', 'false');
    const probe = probeOfficialTheme(document, 'example.com');
    expect(probe.source).toBe('theme-attribute');
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('dark')).toBe('true');
    lane.restore();
    expect(document.documentElement.getAttribute('data-theme')).toBe('auto');
    expect(document.body.getAttribute('dark')).toBe('false');
  });

  it('enables an inert dark alternate stylesheet and restores it', () => {
    const link = document.createElement('link');
    link.setAttribute('data-official-theme-test', '');
    link.rel = 'alternate stylesheet';
    link.title = 'Dark';
    link.href = '/dark.css';
    link.disabled = true;
    document.head.append(link);

    const lane = new OfficialThemeLane({hostname: () => 'docs.example.com'});
    expect(lane.probe().source).toBe('stylesheet');
    expect(lane.activate()).toBe(true);
    expect(link.disabled).toBe(false);
    expect(link.media).toBe('all');
    lane.restore();
    expect(link.disabled).toBe(true);
  });

  it('activates Juejin official dark on html and body', () => {
    document.body.className = 'light-theme';
    const lane = new OfficialThemeLane({hostname: () => 'juejin.cn'});
    expect(lane.activate()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBe('dark');
    expect(document.body.classList.contains('dark-theme')).toBe(true);
    expect(document.body.classList.contains('light-theme')).toBe(false);
    lane.restore();
    expect(document.body.className).toBe('light-theme');
  });
});

describe('official theme visual confirmation', () => {
  const lightEvidence = {
    forcedColors: false,
    negotiatedDark: false,
    declaredLight: true,
    lightCanvas: true,
    visibleContent: true,
    rootDarkMarker: true,
    knownSamples: 9,
    darkCoverage: 0,
    lightCoverage: 1,
    lightOnDarkCoherence: 0,
    darkOnLightCoherence: 1,
  };

  it('rejects a root dark marker that did not actually darken the page', () => {
    const decision: NativeThemeDecision = {
      kind: 'native-dark',
      reason: 'active-root-dark-marker',
      evidence: lightEvidence,
    };
    expect(officialThemeLooksApplied(decision)).toBe(false);
  });

  it('accepts dark rendered surfaces as a successful official switch', () => {
    const decision: NativeThemeDecision = {
      kind: 'native-dark',
      reason: 'dark-rendered-surfaces',
      evidence: {
        ...lightEvidence,
        lightCanvas: false,
        darkCoverage: 0.82,
        lightCoverage: 0.1,
        lightOnDarkCoherence: 0.7,
        darkOnLightCoherence: 0,
        declaredLight: false,
        rootDarkMarker: true,
      },
    };
    expect(officialThemeLooksApplied(decision)).toBe(true);
  });
});
