import {afterEach, describe, expect, it} from 'vitest';
import {
  matchOfficialThemeSite,
  normalizeHostname,
} from '../../src/content/official-theme-catalog';
import {OfficialThemeLane, probeOfficialTheme} from '../../src/content/official-theme';

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
});
