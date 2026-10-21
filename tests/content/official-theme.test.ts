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
    expect([...document.documentElement.classList].sort()).toEqual(['theme-light', 'wrapped']);
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

  it('does not accept negotiated dark with no visible dark evidence', () => {
    expect(officialThemeLooksApplied({
      kind: 'native-dark',
      reason: 'dark-color-scheme-without-light-conflict',
      evidence: {...lightEvidence, negotiatedDark: true, knownSamples: 0},
    })).toBe(false);
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

describe('official theme ownership', () => {
  it('preserves concurrent additions/removals on both roots', () => {
    document.documentElement.className = 'light old-root';
    document.body.className = 'theme-light old-body';
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    document.documentElement.classList.remove('old-root');
    document.documentElement.classList.add('spa-root');
    document.body.classList.remove('old-body');
    document.body.classList.add('modal-open');
    lane.restore();
    expect([...document.documentElement.classList].sort()).toEqual(['light', 'spa-root']);
    expect([...document.body.classList].sort()).toEqual(['modal-open', 'theme-light']);
  });

  it('does not overwrite site replacements of owned attributes or class swaps', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.className = 'light';
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    document.documentElement.setAttribute('data-theme', 'sepia');
    document.body.className = 'route-new';
    lane.restore();
    expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');
    expect(document.body.className).toBe('route-new');
  });

  it('removes its dark token when the site has already restored the light token', () => {
    document.body.className = 'light';
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    document.body.classList.add('light', 'route');
    lane.restore();
    expect([...document.body.classList].sort()).toEqual(['light', 'route']);
  });

  it('does not select an unselected alternate stylesheet set via its default false disabled flag', () => {
    document.head.insertAdjacentHTML('beforeend', '<link data-official-theme-test rel="alternate stylesheet" title="Dark" href="/dark.css">');
    expect(probeOfficialTheme(document, 'example.com').capable).toBe(false);
  });

  it('never restores snapshots onto replacement SPA roots', () => {
    const oldHtml = document.documentElement;
    oldHtml.setAttribute('data-theme', 'light');
    document.body.className = 'light';
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    const nextHtml = oldHtml.cloneNode(true) as HTMLElement;
    nextHtml.setAttribute('data-theme', 'sepia');
    nextHtml.querySelector('body')!.className = 'new-body';
    oldHtml.replaceWith(nextHtml);
    try {
      lane.restore();
      expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');
      expect(document.body.className).toBe('new-body');
    } finally {
      nextHtml.replaceWith(oldHtml);
    }
  });

  it('preserves existing dark tokens with overlapping catalog and generic recipes', () => {
    document.documentElement.className = 'dark light';
    const lane = new OfficialThemeLane({hostname: () => 'bilibili.com'});
    lane.activate();
    document.documentElement.classList.add('spa');
    lane.restore();
    expect([...document.documentElement.classList].sort()).toEqual(['dark', 'light', 'spa']);
  });

  it('selects only authored CSS links, even when feeds share the CSS URL/title', () => {
    document.head.insertAdjacentHTML('beforeend', `
      <link data-official-theme-test rel="alternate" type="application/rss+xml" title="Dark" href="/dark.css" media="none">
      <link data-official-theme-test rel="alternate" hreflang="en" title="Night" href="/en" media="none">
      <link data-official-theme-test rel="alternate stylesheet" type="text/html" title="Dark" href="/html" media="none">
      <link data-official-theme-test data-semantic-dark-sheet rel="stylesheet" title="Dark" href="/owned.css" media="none">
      <link data-official-theme-test rel="alternate stylesheet" type="text/css" title="Dark" href="/dark.css" media="none">
    `);
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[data-official-theme-test]')];
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.probe().recipes).toHaveLength(1);
    lane.activate();
    expect(links.map((link) => link.media)).toEqual(['none', 'none', 'none', 'none', 'all']);
    lane.restore();
    expect(links.map((link) => link.media)).toEqual(['none', 'none', 'none', 'none', 'none']);
  });

  it('restores only the original stylesheet and only unchanged fields', () => {
    const link = document.createElement('link');
    link.setAttribute('data-official-theme-test', '');
    link.rel = 'alternate stylesheet';
    link.title = 'Dark';
    link.href = '/dark.css';
    link.disabled = true;
    document.head.append(link);
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    link.media = 'print';
    const replacement = link.cloneNode() as HTMLLinkElement;
    replacement.disabled = false;
    link.replaceWith(replacement);
    lane.restore();
    expect(link.media).toBe('print');
    expect(link.disabled).toBe(true);
    expect(replacement.media).toBe('print');
    expect(replacement.disabled).toBe(false);
  });

  it('leaves a stylesheet repurposed by the site untouched', () => {
    const link = document.createElement('link');
    link.setAttribute('data-official-theme-test', '');
    link.rel = 'stylesheet';
    link.title = 'Dark';
    link.href = '/dark.css';
    link.disabled = true;
    document.head.append(link);
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    link.href = '/new-route.css';
    lane.restore();
    expect(link.disabled).toBe(false);
  });

  it('waits for pending CSS and cancels its wait on abort', async () => {
    const link = document.createElement('link');
    link.setAttribute('data-official-theme-test', '');
    link.rel = 'stylesheet';
    link.title = 'Dark';
    link.href = '/slow.css';
    link.disabled = true;
    document.head.append(link);
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    lane.activate();
    const abort = new AbortController();
    let settled = false;
    const pending = lane.settle(abort.signal).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    link.dispatchEvent(new Event('load'));
    await pending;
    const cancelled = lane.settle(abort.signal);
    abort.abort();
    await cancelled;
    lane.restore();
  });
});

describe('review regressions', () => {
  it('preserves constructor classes and theme values alongside valid switches', () => {
    document.documentElement.className = 'constructor __proto__ light';
    document.documentElement.setAttribute('data-theme', 'constructor');
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.activate()).toBe(true);
    expect([...document.documentElement.classList].sort()).toEqual(['__proto__', 'constructor', 'dark']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('constructor');
    lane.restore();
    expect([...document.documentElement.classList].sort()).toEqual(['__proto__', 'constructor', 'light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('constructor');
  });

  it('keeps duplicate href/title stylesheets scoped to each probed element', () => {
    const links = ['none', 'print', 'print', 'none'].map((media, index) => {
      const link = document.createElement('link');
      link.setAttribute('data-official-theme-test', '');
      link.rel = 'stylesheet';
      link.title = 'Dark';
      link.href = '/duplicate.css';
      link.media = media;
      link.disabled = index === 2;
      document.head.append(link);
      return link;
    });
    const untouched = new MutationObserver(() => {});
    untouched.observe(links[1]!, {attributes: true});
    const lane = new OfficialThemeLane({hostname: () => 'example.com'});
    expect(lane.probe().recipes).toHaveLength(3);
    lane.activate();
    expect(links.map((link) => [link.media, link.disabled])).toEqual([
      ['all', false], ['print', false], ['print', false], ['all', false],
    ]);
    expect(untouched.takeRecords()).toEqual([]);
    lane.restore();
    expect(links.map((link) => [link.media, link.disabled])).toEqual([
      ['none', false], ['print', false], ['print', true], ['none', false],
    ]);
    expect(untouched.takeRecords()).toEqual([]);
    untouched.disconnect();
  });
});
