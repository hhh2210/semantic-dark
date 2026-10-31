import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  readPageState,
  readNativeDarkState,
  readOfficialThemeState,
  verifyBaselineState,
  verifyNativeDarkState,
  verifyOfficialThemeState,
  verifyPopupMetrics,
  verifyRestoredState,
  verifyTransformedState,
  waitForProcessedState,
  waitForRestoredState,
} from '../src/testing/e2e/assertions.mjs';
import {contrastRatio, parseRgb} from '../src/testing/e2e/colors.mjs';
import {exerciseOfficialTheme} from '../src/testing/e2e/official-theme.mjs';
import {exerciseInteractiveDomEffects} from '../src/testing/e2e/dom-effects.mjs';
import {
  installPrepaintRecorder,
  readPrepaintRecord,
  verifyPrepaintCascade,
  verifyPrepaintedDocument,
  waitForPrepaintExclusion,
  waitForPrepaintReleased,
} from '../src/testing/e2e/prepaint.mjs';
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
    ['/favicon.ico', (_request, response) => { response.writeHead(204); response.end(); }],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/fixture.css', ['fixture.css', 'text/css; charset=utf-8']],
    ['/icon.svg', ['icon.svg', 'image/svg+xml; charset=utf-8']],
    ['/raster-diagram.svg', ['raster-diagram.svg', 'image/svg+xml; charset=utf-8']],
    ['/native-dark.html', ['native-dark.html', 'text/html; charset=utf-8']],
    ['/native-dark.css', ['native-dark.css', 'text/css; charset=utf-8']],
    ['/official-theme.html', ['official-theme.html', 'text/html; charset=utf-8']],
    ['/official-theme.css', ['official-theme.css', 'text/css; charset=utf-8']],
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
  const popupOfficialPath = path.join(CONFIG.artifactDir, 'popup-official-dark.png');
  const profilePath = await mkdtemp(path.join(tmpdir(), 'semantic-dark-e2e-'));
  const fixture = await createFixtureServer(CONFIG);
  let session;
  console.error(`Disposable E2E profile: ${profilePath}`);
  let deadline;
  const abort = new AbortController();
  const overallTimeout = Number(process.env.E2E_TIMEOUT_MS ?? 120_000);

  const run = async () => {
    const baseline = await captureBaseline({
      ...CONFIG,
      signal: abort.signal,
      url: fixture.url,
      screenshotPath: beforePath,
      readState: readPageState,
    });
    verifyBaselineState(baseline.state);

    session = await openExtensionSession({
      ...CONFIG,
      signal: abort.signal,
      profilePath,
      url: fixture.url,
      colorScheme: 'dark',
    });
    const expectedHost = new URL(fixture.url).host;
    // The first document can load before the worker registers the
    // document_start script; reload once it is registered.
    await installPrepaintRecorder(session.page);
    await waitForPrepaintExclusion({session, host: expectedHost, excluded: false, timeout: CONFIG.timeout});
    await session.page.reload({waitUntil: 'networkidle'});
    try {
      await waitForProcessedState(session.page, CONFIG.timeout);
    } catch (error) {
      const state = await readPageState(session.page);
      throw new Error(
        `Extension did not produce all runtime markers:\n${JSON.stringify(sessionDiagnostics(session, state), null, 2)}`,
        {cause: error},
      );
    }

    await waitForPrepaintReleased(session.page, CONFIG.timeout);
    const lightPrepaint = await readPrepaintRecord(session.page);
    verifyPrepaintedDocument(lightPrepaint, 'light fixture');
    const prepaintCascade = await verifyPrepaintCascade(session.page);
    const transformed = await readPageState(session.page);
    const initialMetrics = verifyTransformedState(transformed);
    const interactionMetrics = await exerciseInteractiveDomEffects(session.page, CONFIG.timeout);

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
    // A disabled host must never get the dark base, not even for one frame.
    await waitForPrepaintExclusion({session, host: expectedHost, excluded: true, timeout: CONFIG.timeout});
    await session.page.reload({waitUntil: 'networkidle'});
    await waitForRestoredState(session.page, CONFIG.timeout);
    const disabledPrepaint = await readPrepaintRecord(session.page);
    assert.equal(disabledPrepaint.painted, null, 'A disabled host was painted with the dark base');

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
    await waitForPrepaintExclusion({session, host: expectedHost, excluded: false, timeout: CONFIG.timeout});
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
    const nativePrepaint = await readPrepaintRecord(session.page);
    verifyPrepaintedDocument(nativePrepaint, 'native-dark fixture');
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

    const officialUrl = new URL('/official-theme.html', fixture.url).href;
    await session.page.goto(officialUrl, {waitUntil: 'networkidle'});
    await session.page.waitForFunction(() =>
      document.documentElement.getAttribute('data-theme') === 'dark' &&
      !document.documentElement.hasAttribute('data-semantic-dark-active'),
    undefined, {timeout: CONFIG.timeout});
    const officialPopup = await inspectCurrentPopup({
      session,
      expectedHost,
      expectedDecision: 'official-dark',
      expectedEnabled: false,
      screenshotPath: popupOfficialPath,
      colorScheme: 'dark',
      timeout: CONFIG.timeout,
    });
    verifyPopupMetrics(officialPopup, {appearanceHidden: true});
    assert.equal(officialPopup.badge, 'Site dark');
    const officialState = await readOfficialThemeState(session.page);
    verifyOfficialThemeState(officialState);
    const officialPrepaint = await readPrepaintRecord(session.page);
    verifyPrepaintedDocument(officialPrepaint, 'official-theme fixture');

    await session.page.emulateMedia({colorScheme: 'light'});
    await session.page.waitForFunction(() =>
      document.documentElement.getAttribute('data-theme') === 'light' &&
      !document.documentElement.hasAttribute('data-semantic-dark-active'),
    undefined, {timeout: CONFIG.timeout});
    await session.page.emulateMedia({colorScheme: 'dark'});

    const officialRegression = await exerciseOfficialTheme({
      session, fixtureUrl: fixture.url, fixtureDir: CONFIG.fixtureDir, artifactDir: CONFIG.artifactDir, routes: CONFIG.routes, timeout: CONFIG.timeout,
    });

    const [beforeStats, afterStats, popupLightStats, popupDarkStats, popupNativeStats, popupOfficialStats] =
      await Promise.all([
        stat(beforePath),
        stat(afterPath),
        stat(popupLightPath),
        stat(popupDarkPath),
        stat(popupNativePath),
        stat(popupOfficialPath),
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
      officialRegression,
      prepaint: {
        light: lightPrepaint,
        disabled: disabledPrepaint,
        nativeDark: nativePrepaint,
        official: officialPrepaint,
        cascade: prepaintCascade,
      },
      officialTheme: {
        url: officialUrl,
        state: officialState,
        popup: officialPopup,
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
        popupOfficial: {path: popupOfficialPath, bytes: popupOfficialStats.size},
      },
      consoleMessages: session.consoleMessages,
      pageErrors: session.pageErrors,
    }, null, 2));
  };
  const running = run();
  try {
    await Promise.race([running, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`E2E exceeded ${overallTimeout} milliseconds`)), overallTimeout);
    })]);
  } finally {
    clearTimeout(deadline);
    abort.abort(new Error('E2E finished or timed out'));
    // Await late browser acquisition/closure before deleting its profile.
    await running.catch(() => {});
    try {
      await session?.close();
    } finally {
      await fixture.close();
      await rm(profilePath, {recursive: true, force: true});
    }
    console.error(`Removed E2E profile: ${profilePath}`);
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
