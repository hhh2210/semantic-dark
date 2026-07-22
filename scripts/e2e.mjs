import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  readPageState,
  readNativeDarkState,
  verifyBaselineState,
  verifyNativeDarkState,
  verifyPopupMetrics,
  verifyRestoredState,
  verifyTransformedState,
  waitForProcessedState,
  waitForRestoredState,
} from '../src/testing/e2e/assertions.mjs';
import {contrastRatio, parseRgb} from '../src/testing/e2e/colors.mjs';
import {exerciseInteractiveDomEffects} from '../src/testing/e2e/dom-effects.mjs';
import {verifyRgba8Quantization} from '../src/testing/e2e/rgba8-quantization.mjs';
import {
  captureBaseline,
  inspectCurrentPopup,
  openExtensionSession,
  resetCurrentHostAutomatic,
  sessionDiagnostics,
  setCurrentHostEnabled,
} from '../src/testing/e2e/chrome-session.mjs';
import {assertE2eInputs, createFixtureServer} from '../src/testing/e2e/server.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG = {
  fixtureDir: path.join(ROOT, 'fixtures', 'integration'),
  extensionDir: path.join(ROOT, 'dist'),
  artifactDir: path.join(ROOT, 'artifacts'),
  chromePath: process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: process.env.HEADED !== '1',
  viewport: {width: 1280, height: 900},
  timeout: 15_000,
  routes: new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/fixture.css', ['fixture.css', 'text/css; charset=utf-8']],
    ['/icon.svg', ['icon.svg', 'image/svg+xml; charset=utf-8']],
    ['/raster-diagram.svg', ['raster-diagram.svg', 'image/svg+xml; charset=utf-8']],
    ['/native-dark.html', ['native-dark.html', 'text/html; charset=utf-8']],
    ['/native-dark.css', ['native-dark.css', 'text/css; charset=utf-8']],
  ]),
};

async function main() {
  await assertE2eInputs(CONFIG);
  await verifyRgba8Quantization(CONFIG);
  await mkdir(CONFIG.artifactDir, {recursive: true});
  const beforePath = path.join(CONFIG.artifactDir, 'e2e-before.png');
  const afterPath = path.join(CONFIG.artifactDir, 'e2e-after.png');
  const popupLightPath = path.join(CONFIG.artifactDir, 'popup-light.png');
  const popupDarkPath = path.join(CONFIG.artifactDir, 'popup-dark.png');
  const popupNativePath = path.join(CONFIG.artifactDir, 'popup-native-dark.png');
  const profilePath = await mkdtemp(path.join(tmpdir(), 'semantic-dark-e2e-'));
  const fixture = await createFixtureServer(CONFIG);
  let session;

  try {
    const baseline = await captureBaseline({
      ...CONFIG,
      url: fixture.url,
      screenshotPath: beforePath,
      readState: readPageState,
    });
    verifyBaselineState(baseline.state);

    session = await openExtensionSession({
      ...CONFIG,
      profilePath,
      url: fixture.url,
      colorScheme: 'dark',
    });
    try {
      await waitForProcessedState(session.page, CONFIG.timeout);
    } catch (error) {
      const state = await readPageState(session.page);
      throw new Error(
        `Extension did not produce all runtime markers:\n${JSON.stringify(sessionDiagnostics(session, state), null, 2)}`,
        {cause: error},
      );
    }

    const transformed = await readPageState(session.page);
    const initialMetrics = verifyTransformedState(transformed);
    const interactionMetrics = await exerciseInteractiveDomEffects(session.page, CONFIG.timeout);

    const expectedHost = new URL(fixture.url).host;
    await session.page.emulateMedia({colorScheme: 'light'});
    await waitForRestoredState(session.page, CONFIG.timeout);
    const popupLight = await inspectCurrentPopup({
      session,
      expectedHost,
      expectedDecision: 'system-light',
      expectedEnabled: false,
      screenshotPath: popupLightPath,
      colorScheme: 'light',
      timeout: CONFIG.timeout,
    });
    verifyPopupMetrics(popupLight, {appearanceHidden: true});
    assert.equal(popupLight.badge, 'System light');

    await session.page.emulateMedia({colorScheme: 'dark'});
    await waitForProcessedState(session.page, CONFIG.timeout);
    const popupDark = await inspectCurrentPopup({
      session,
      expectedHost,
      expectedDecision: 'applied-light',
      expectedEnabled: true,
      screenshotPath: popupDarkPath,
      colorScheme: 'dark',
      timeout: CONFIG.timeout,
    });
    verifyPopupMetrics(popupDark, {appearanceHidden: false});
    assert.equal(popupDark.badge, 'On');
    await session.page.screenshot({path: afterPath, fullPage: true});

    const disableTransition = await setCurrentHostEnabled({
      session,
      enabled: false,
      expectedInitial: true,
      expectedHost,
      timeout: CONFIG.timeout,
    });
    await waitForRestoredState(session.page, CONFIG.timeout);
    const restored = await readPageState(session.page);
    verifyRestoredState(restored);

    const enableTransition = await setCurrentHostEnabled({
      session,
      enabled: true,
      expectedInitial: false,
      expectedHost,
      timeout: CONFIG.timeout,
    });
    await waitForProcessedState(session.page, CONFIG.timeout);
    const reprocessed = await readPageState(session.page);
    const reprocessedMetrics = verifyTransformedState(reprocessed);

    const automaticTransition = await resetCurrentHostAutomatic({
      session,
      expectedHost,
      timeout: CONFIG.timeout,
    });
    const nativeUrl = new URL('/native-dark.html', fixture.url).href;
    await session.page.goto(nativeUrl, {waitUntil: 'networkidle'});
    const nativePopup = await inspectCurrentPopup({
      session,
      expectedHost,
      expectedDecision: 'native-dark',
      expectedEnabled: false,
      screenshotPath: popupNativePath,
      colorScheme: 'dark',
      timeout: CONFIG.timeout,
    });
    verifyPopupMetrics(nativePopup, {appearanceHidden: true});
    assert.equal(nativePopup.badge, 'Already dark');
    assert.equal(nativePopup.enabledDisabled, false,
      'Native-dark state should retain a manual force-on escape hatch');
    const nativeState = await readNativeDarkState(session.page);
    verifyNativeDarkState(nativeState);
    await session.page.waitForTimeout(250);
    const animationBefore = await animationCurrentTime(session.page);

    await replaceRuntimeTheme(session.page, 'light');
    await session.page.waitForFunction(() => {
      const card = document.querySelector('#native-dark-card');
      return document.documentElement.hasAttribute('data-semantic-dark-active') &&
        card?.hasAttribute('data-semantic-dark-background') &&
        getComputedStyle(document.documentElement).backgroundColor === 'rgb(17, 20, 22)';
    }, undefined, {timeout: CONFIG.timeout});
    const cssomLightState = await session.page.evaluate(() => {
      const card = document.querySelector('#native-dark-card');
      if (!card) throw new Error('Native dark fixture card is missing');
      return {
        active: document.documentElement.hasAttribute('data-semantic-dark-active'),
        rootBackground: getComputedStyle(document.documentElement).backgroundColor,
        cardBackground: getComputedStyle(card).backgroundColor,
        headingText: getComputedStyle(card.querySelector('h1')).color,
      };
    });
    assert.ok(contrastRatio(
      parseRgb(cssomLightState.headingText),
      parseRgb(cssomLightState.cardBackground),
    ) >= 4.5, 'CSSOM light-to-dark transition produced unreadable card text');
    const animationAfterLight = await animationCurrentTime(session.page);
    assert.ok(animationAfterLight >= animationBefore - 50,
      'Source probing restarted a running CSS animation');

    await replaceRuntimeTheme(session.page, 'dark');
    await session.page.waitForFunction(() =>
      !document.documentElement.hasAttribute('data-semantic-dark-active') &&
      !document.querySelector('[data-semantic-dark-background]'), undefined, {timeout: CONFIG.timeout});
    const cssomDarkState = await readNativeDarkState(session.page);
    verifyNativeDarkState(cssomDarkState);
    const animationAfterDark = await animationCurrentTime(session.page);
    assert.ok(animationAfterDark >= animationAfterLight - 50,
      'Theme deactivation restarted a running CSS animation');

    const [beforeStats, afterStats, popupLightStats, popupDarkStats, popupNativeStats] =
      await Promise.all([
        stat(beforePath),
        stat(afterPath),
        stat(popupLightPath),
        stat(popupDarkPath),
        stat(popupNativePath),
      ]);
    console.log(JSON.stringify({
      ok: true,
      chromePath: CONFIG.chromePath,
      chromeVersion: baseline.browserVersion,
      fixtureUrl: fixture.url,
      extensionId: session.extensionId,
      serviceWorkerUrl: session.serviceWorkerUrl,
      baseline: baseline.state,
      transformed,
      restored,
      reprocessed,
      transitions: {
        disable: disableTransition,
        enable: enableTransition,
        automatic: automaticTransition,
      },
      nativeDark: {
        url: nativeUrl,
        state: nativeState,
        popup: nativePopup,
        cssomTransition: {
          light: cssomLightState,
          restoredDark: cssomDarkState,
          animationCurrentTime: {before: animationBefore, light: animationAfterLight, dark: animationAfterDark},
        },
      },
      popup: {light: popupLight, dark: popupDark},
      metrics: {initial: initialMetrics, reprocessed: reprocessedMetrics},
      interactionMetrics,
      rasterTimingsMs: {
        initial: {
          wall: initialMetrics.rasterMs,
          mainThread: initialMetrics.rasterMainMs,
          dispatch: initialMetrics.rasterDispatchMs,
          worker: initialMetrics.rasterWorkerMs,
        },
        reprocessed: {
          wall: reprocessedMetrics.rasterMs,
          mainThread: reprocessedMetrics.rasterMainMs,
          dispatch: reprocessedMetrics.rasterDispatchMs,
          worker: reprocessedMetrics.rasterWorkerMs,
        },
      },
      screenshots: {
        before: {path: beforePath, bytes: beforeStats.size},
        after: {path: afterPath, bytes: afterStats.size},
        popupLight: {path: popupLightPath, bytes: popupLightStats.size},
        popupDark: {path: popupDarkPath, bytes: popupDarkStats.size},
        popupNative: {path: popupNativePath, bytes: popupNativeStats.size},
      },
      consoleMessages: session.consoleMessages,
      pageErrors: session.pageErrors,
    }, null, 2));
  } finally {
    await session?.close();
    await fixture.close();
    await rm(profilePath, {recursive: true, force: true});
  }
}

async function replaceRuntimeTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    if (!(globalThis.runtimeThemeSheet instanceof CSSStyleSheet)) {
      globalThis.runtimeThemeSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, globalThis.runtimeThemeSheet];
    }
    globalThis.runtimeThemeSheet.replaceSync(nextTheme === 'light' ? `
      :root { color-scheme: light; background: #ffffff; color: #171a1f; }
      body, #native-dark-canvas { background: #ffffff; color: #171a1f; }
      #native-dark-card { background: #f2f4f7; border-color: #d2d6dc; }
      #native-dark-card h1, #native-dark-card p { color: #22262d; }
    ` : '');
  }, theme);
}

async function animationCurrentTime(page) {
  return page.evaluate(() => {
    const animation = document.querySelector('#animation-probe')?.getAnimations()[0];
    if (typeof animation?.currentTime !== 'number') throw new Error('Animation probe is not running');
    return animation.currentTime;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
