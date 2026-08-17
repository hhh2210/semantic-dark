import {mkdtemp, mkdir, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DATA_ROOT = process.env.SEMANTIC_DARK_DATA_ROOT ?? path.join(process.env.HOME ?? '/home/ubuntu', 'scratch-data', 'semantic-dark-cross-site');
const MANIFEST_PATH = process.env.SEMANTIC_DARK_SITE_MANIFEST ?? path.join(DATA_ROOT, 'sites.v1.json');
const OUTPUT_PATH = process.env.SEMANTIC_DARK_OUTPUT ?? path.join(DATA_ROOT, 'metrics', 'site-observations.v1.jsonl');
const CAPTURE_ROOT = path.join(DATA_ROOT, 'captures');
const CHROME_PATH = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const VIEWPORT = {width: 1440, height: 900};
const TIMEOUT = Number(process.env.SEMANTIC_DARK_TIMEOUT_MS ?? 15_000);
const NAV_WAIT_UNTIL = process.env.SEMANTIC_DARK_NAV_WAIT_UNTIL ?? 'commit';
const SETTLE_MS = Number(process.env.SEMANTIC_DARK_SETTLE_MS ?? 2_500);
const MAX_SITES = Number(process.env.SEMANTIC_DARK_MAX_SITES ?? 0);
const START_INDEX = Number(process.env.SEMANTIC_DARK_START_INDEX ?? 0);
const extensionDir = path.join(ROOT, 'dist');
const markerSelector = [
  '[data-semantic-dark-active]',
  '[data-semantic-dark-color]',
  '[data-semantic-dark-background]',
  '[data-semantic-dark-background-image]',
  '[data-semantic-dark-border]',
  '[data-semantic-dark-decoration]',
  '[data-semantic-dark-before-color]',
  '[data-semantic-dark-before-background]',
  '[data-semantic-dark-before-background-image]',
  '[data-semantic-dark-before-border]',
  '[data-semantic-dark-after-color]',
  '[data-semantic-dark-after-background]',
  '[data-semantic-dark-after-background-image]',
  '[data-semantic-dark-after-border]',
  '[data-semantic-dark-svg]',
  '[data-semantic-dark-image-filter]',
  '[data-semantic-dark-raster-status]',
].join(',');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function safeSlug(value) {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function waitSettled(page) {
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })).catch(() => undefined);
}

async function screenshotWithHash(page, outputPath) {
  const buffer = await page.screenshot({path: outputPath, type: 'png', animations: 'disabled'});
  return {path: outputPath, sha256: sha256(buffer), bytes: buffer.length, pixelStats: pixelStats(buffer)};
}

function pixelStats(buffer) {
  const png = PNG.sync.read(buffer);
  let bright = 0;
  let dark = 0;
  let nonTransparent = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const alpha = png.data[i + 3];
    if (alpha === 0) continue;
    nonTransparent++;
    const luminance = (0.2126 * png.data[i]) + (0.7152 * png.data[i + 1]) + (0.0722 * png.data[i + 2]);
    if (luminance >= 245) bright++;
    if (luminance <= 40) dark++;
  }
  const denominator = Math.max(1, nonTransparent);
  return {
    width: png.width,
    height: png.height,
    bright_fraction: Number((bright / denominator).toFixed(6)),
    dark_fraction: Number((dark / denominator).toFixed(6)),
  };
}

async function inspectPage(page, extensionMode, expectedLayer) {
  return page.evaluate(({mode, layer, selector}) => {
    const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
    const parseColor = (value) => {
      if (!value || value === 'transparent' || value === 'none') return null;
      const rgba = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[,/]\s*([\d.]+%?|[\d.]+))?\s*\)$/i);
      if (rgba) {
        const alphaRaw = rgba[4] ?? '1';
        const alpha = alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
        return {r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: clamp(alpha)};
      }
      const hex = value.match(/^#([0-9a-f]{3,8})$/i);
      if (!hex) return null;
      const raw = hex[1];
      const pair = (text) => text.length === 1 ? Number.parseInt(text + text, 16) : Number.parseInt(text, 16);
      return raw.length <= 4
        ? {r: pair(raw[0]), g: pair(raw[1]), b: pair(raw[2]), a: raw.length === 4 ? pair(raw[3]) / 255 : 1}
        : {r: pair(raw.slice(0, 2)), g: pair(raw.slice(2, 4)), b: pair(raw.slice(4, 6)), a: raw.length === 8 ? pair(raw.slice(6, 8)) / 255 : 1};
    };
    const composite = (foreground, background) => {
      if (!foreground) return null;
      if (foreground.a >= 0.999 || !background) return foreground;
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha <= 0) return {r: 0, g: 0, b: 0, a: 0};
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const relativeLuminance = (color) => {
      if (!color) return null;
      const channel = (v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
    };
    const contrast = (a, b) => {
      const la = relativeLuminance(a);
      const lb = relativeLuminance(b);
      if (la === null || lb === null) return null;
      const hi = Math.max(la, lb);
      const lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const backgroundFor = (element) => {
      let current = element;
      while (current && current instanceof Element) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.01) return color;
        current = current.parentElement;
      }
      return parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? {r: 255, g: 255, b: 255, a: 1};
    };
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    const elements = [...document.querySelectorAll('body *')].filter(visible).slice(0, 700);
    const textContrasts = [];
    const nonTextContrasts = [];
    const colorKinds = new Set();
    const candidates = [];
    for (const element of elements) {
      const style = getComputedStyle(element);
      const background = backgroundFor(element);
      const foreground = composite(parseColor(style.color), background);
      if (style.color && foreground && (element.textContent ?? '').trim().length > 0) {
        const value = contrast(foreground, background);
        if (value !== null && Number.isFinite(value)) textContrasts.push(value);
      }
      const border = parseColor(style.borderTopColor);
      if (border && background && /^(BUTTON|INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(element.tagName)) {
        const value = contrast(composite(border, background), background);
        if (value !== null && Number.isFinite(value)) nonTextContrasts.push(value);
      }
      const bg = parseColor(style.backgroundColor);
      if (bg && bg.a > 0.01) colorKinds.add(`${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}`);
      if (candidates.length < 120 && /^(MAIN|ARTICLE|NAV|BUTTON|INPUT|PRE|CODE|IMG|SVG|TABLE|TR|SECTION|ASIDE|DIALOG)$/.test(element.tagName)) {
        candidates.push({
          tag: element.tagName,
          role: element.getAttribute('role'),
          class_count: element.classList.length,
          width: Math.round(element.getBoundingClientRect().width),
          height: Math.round(element.getBoundingClientRect().height),
          background: style.backgroundColor,
          color: style.color,
          border: style.borderTopColor,
        });
      }
    }
    const sortNumeric = (values) => values.sort((a, b) => a - b);
    const rootBackground = parseColor(rootStyle.backgroundColor);
    const bodyBackground = bodyStyle ? parseColor(bodyStyle.backgroundColor) : null;
    const pageBackground = bodyBackground && bodyBackground.a > 0.01 ? bodyBackground : rootBackground;
    const pageForeground = parseColor(bodyStyle?.color ?? rootStyle.color);
    const authoredDarkLike = Boolean(
      rootStyle.colorScheme.toLowerCase().includes('dark') ||
      (pageBackground && pageForeground && relativeLuminance(pageBackground) < 0.25 && relativeLuminance(pageForeground) > 0.35)
    );
    const markerCount = document.querySelectorAll(selector).length;
    const active = document.documentElement.hasAttribute('data-semantic-dark-active');
    return {
      mode,
      expected_layer: layer,
      url: location.href,
      host: location.host,
      title_length: document.title.length,
      viewport: {width: innerWidth, height: innerHeight, device_scale_factor: devicePixelRatio},
      root_background_rgb: rootBackground ? [Math.round(rootBackground.r), Math.round(rootBackground.g), Math.round(rootBackground.b), Number(rootBackground.a.toFixed(3))] : null,
      body_background_rgb: bodyBackground ? [Math.round(bodyBackground.r), Math.round(bodyBackground.g), Math.round(bodyBackground.b), Number(bodyBackground.a.toFixed(3))] : null,
      root_color: rootStyle.color,
      body_color: bodyStyle?.color ?? null,
      color_scheme: rootStyle.colorScheme,
      prefers_dark: matchMedia('(prefers-color-scheme: dark)').matches,
      authored_dark_like: authoredDarkLike,
      active,
      marker_count: markerCount,
      element_count_sampled: elements.length,
      distinct_surface_colors: colorKinds.size,
      min_text_contrast: textContrasts.length ? Number(Math.min(...sortNumeric(textContrasts)).toFixed(3)) : null,
      p10_text_contrast: textContrasts.length ? Number(sortNumeric(textContrasts)[Math.floor(textContrasts.length * 0.1)].toFixed(3)) : null,
      min_non_text_contrast: nonTextContrasts.length ? Number(Math.min(...sortNumeric(nonTextContrasts)).toFixed(3)) : null,
      representative_elements: candidates,
    };
  }, {mode: extensionMode, layer: expectedLayer, selector: markerSelector});
}

async function createBaselinePage(browser, url) {
  const context = await browser.newContext({viewport: VIEWPORT, ignoreHTTPSErrors: true, serviceWorkers: 'allow'});
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(url, {waitUntil: NAV_WAIT_UNTIL, timeout: TIMEOUT});
    await waitSettled(page);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }
  return {context, page, response, navigationError, consoleErrors, pageErrors};
}

async function createExtensionSession(profilePath, url) {
  const consoleErrors = [];
  const pageErrors = [];
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: CHROME_PATH,
    headless: process.env.HEADED !== '1',
    viewport: VIEWPORT,
    colorScheme: 'dark',
    ignoreHTTPSErrors: true,
    args: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch,DisableDisableExtensionsExceptCommandLineSwitch',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(url, {waitUntil: NAV_WAIT_UNTIL, timeout: TIMEOUT});
    await waitSettled(page);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }
  return {context, page, response, navigationError, consoleErrors, pageErrors};
}

async function collectSite(site, index, total) {
  const slug = safeSlug(site.id);
  const siteDir = path.join(CAPTURE_ROOT, slug);
  await mkdir(siteDir, {recursive: true});
  const result = {
    schema: 'semantic-dark.cross-site-observation.v1',
    site_id: site.id,
    url: site.url,
    expected_layer: site.expected_layer,
    family: site.family,
    site_family: site.site_family ?? site.family,
    page_type: site.page_type ?? 'other',
    features: site.features ?? [],
    access_risk: site.access_risk ?? 'unknown',
    split: site.split ?? 'unassigned',
    source: site.source ?? 'legacy',
    viewport: {...VIEWPORT, device_scale_factor: 1},
    capture_policy: 'manual-public-no-auth-no-crawl',
    index,
    total,
    captured_at: nowIso(),
  };
  console.log(`[${index}/${total}] ${site.id} ${site.url}`);
  const baselineBrowser = await chromium.launch({executablePath: CHROME_PATH, headless: process.env.HEADED !== '1'});
  const baseline = await createBaselinePage(baselineBrowser, site.url);
  result.browser_version = baselineBrowser.version();
  result.baseline = {navigation_error: baseline.navigationError, status: baseline.response?.status() ?? null, url: baseline.page.url(), console_error_count: baseline.consoleErrors.length, page_error_count: baseline.pageErrors.length};
  result.content_eligible = Boolean(!baseline.navigationError && baseline.response && result.baseline.status >= 200 && result.baseline.status < 400);
  if (!result.content_eligible) result.exclude_reason = result.baseline.navigation_error ?? `http-${result.baseline.status}`;
  try {
    if (result.content_eligible && baseline.response) {
      await baseline.page.emulateMedia({colorScheme: 'light'});
      await waitSettled(baseline.page);
      result.light_baseline = await inspectPage(baseline.page, 'baseline-light', site.expected_layer);
      result.light_screenshot = await screenshotWithHash(baseline.page, path.join(siteDir, 'baseline-light.png'));
      await baseline.page.emulateMedia({colorScheme: 'dark'});
      await waitSettled(baseline.page);
      result.dark_baseline = await inspectPage(baseline.page, 'baseline-dark', site.expected_layer);
      result.dark_screenshot = await screenshotWithHash(baseline.page, path.join(siteDir, 'baseline-dark.png'));
    }
  } finally {
    await baseline.context.close().catch(() => undefined);
    await baselineBrowser.close().catch(() => undefined);
  }

  const profilePath = await mkdtemp(path.join(tmpdir(), 'semantic-dark-site-'));
  let session;
  try {
    session = await createExtensionSession(profilePath, site.url);
    result.extension = {navigation_error: session.navigationError, status: session.response?.status() ?? null, url: session.page.url(), console_error_count: session.consoleErrors.length, page_error_count: session.pageErrors.length};
    if (result.content_eligible && !session.navigationError && session.response) {
      result.automatic_dark = await inspectPage(session.page, 'automatic-dark', site.expected_layer);
      result.after_screenshot = await screenshotWithHash(session.page, path.join(siteDir, 'automatic-dark.png'));
      await session.page.emulateMedia({colorScheme: 'light'});
      await waitSettled(session.page);
      result.restored_light = await inspectPage(session.page, 'restored-light', site.expected_layer);
      await session.page.emulateMedia({colorScheme: 'dark'});
      await waitSettled(session.page);
      result.reapplied_dark = await inspectPage(session.page, 'reapplied-dark', site.expected_layer);
      result.restore_equal = Boolean(
        result.restored_light.marker_count === 0 &&
        !result.restored_light.active &&
        result.light_baseline &&
        result.restored_light.root_background_rgb?.join(',') === result.light_baseline.root_background_rgb?.join(',') &&
        result.restored_light.body_background_rgb?.join(',') === result.light_baseline.body_background_rgb?.join(',')
      );
      result.dark_activation = Boolean(result.automatic_dark.active);
      result.algorithm_noop = !result.dark_activation;
      result.expected_activation = site.expected_layer === 'light-only' ? true : site.expected_layer === 'native-dark' ? false : null;
      result.activation_match = result.expected_activation === null ? null : result.dark_activation === result.expected_activation;
      result.native_dark_decision = site.expected_layer === 'native-dark' ? result.algorithm_noop : null;
      result.bright_surface_fraction_before = result.dark_screenshot?.pixelStats?.bright_fraction ?? null;
      result.bright_surface_fraction_after = result.after_screenshot?.pixelStats?.bright_fraction ?? null;
      result.bright_surface_fraction_delta = result.bright_surface_fraction_before === null || result.bright_surface_fraction_after === null
        ? null
        : Number((result.bright_surface_fraction_after - result.bright_surface_fraction_before).toFixed(6));
    }
  } catch (error) {
    result.extension_error = error instanceof Error ? error.message : String(error);
  } finally {
    await session?.context.close().catch(() => undefined);
    await rm(profilePath, {recursive: true, force: true}).catch(() => undefined);
  }
  return result;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const allSites = manifest.sites;
  const sites = MAX_SITES > 0
    ? allSites.slice(START_INDEX, START_INDEX + MAX_SITES)
    : allSites.slice(START_INDEX);
  await mkdir(path.dirname(OUTPUT_PATH), {recursive: true});
  await mkdir(CAPTURE_ROOT, {recursive: true});
  const output = [];
  for (let i = 0; i < sites.length; i++) {
    const observation = await collectSite(sites[i], START_INDEX + i + 1, allSites.length);
    output.push(observation);
    await writeFile(OUTPUT_PATH, output.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const summary = {
    schema: 'semantic-dark.cross-site-summary.v1',
    captured_at: nowIso(),
    manifest: MANIFEST_PATH,
    output: OUTPUT_PATH,
    site_count: output.length,
    manifest_site_count: allSites.length,
    start_index: START_INDEX,
    max_sites: MAX_SITES || null,
    loaded_count: output.filter((row) => row.content_eligible && row.extension?.status >= 200 && row.extension?.status < 400).length,
    excluded_count: output.filter((row) => row.content_eligible === false).length,
    active_count: output.filter((row) => row.dark_activation).length,
    native_dark_decision_count: output.filter((row) => row.native_dark_decision).length,
    restore_equal_count: output.filter((row) => row.restore_equal).length,
    extension_errors: output.filter((row) => row.extension_error).length,
    observations: output.map((row) => ({
      site_id: row.site_id,
      family: row.family,
      site_family: row.site_family,
      page_type: row.page_type,
      split: row.split,
      access_risk: row.access_risk,
      expected_layer: row.expected_layer,
      observed_authored_dark_like: row.dark_baseline?.authored_dark_like ?? null,
      dark_activation: row.dark_activation ?? null,
      algorithm_noop: row.algorithm_noop ?? null,
      expected_activation: row.expected_activation ?? null,
      activation_match: row.activation_match ?? null,
      native_dark_decision: row.native_dark_decision ?? null,
      restore_equal: row.restore_equal ?? null,
      status: row.extension?.status ?? null,
      host: row.extension?.url ? new URL(row.extension.url).host : null,
      excluded: row.content_eligible === false,
      error: row.extension_error ?? row.exclude_reason ?? row.baseline?.navigation_error ?? null,
    })),
  };
  const summaryPath = path.join(path.dirname(OUTPUT_PATH), 'site-summary.v1.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
