import {readFile, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const sites = JSON.parse(await readFile(process.argv[2] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/sites.v1.json', 'utf8')).sites
  .filter((site) => ['light-hackernews', 'light-w3c', 'light-wikipedia', 'light-python', 'light-pypi', 'light-lobsters'].includes(site.id));
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const output = [];
const browser = await chromium.launch({executablePath: chromePath, headless: true});
for (const site of sites) {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, colorScheme: 'dark', ignoreHTTPSErrors: true});
  let response = null;
  let error = null;
  try {
    response = await page.goto(site.url, {waitUntil: 'domcontentloaded', timeout: 15000});
    await page.waitForTimeout(1800);
    const evidence = await page.evaluate(() => {
      const DARK_LUMINANCE = 0.18;
      const LIGHT_LUMINANCE = 0.55;
      const GRID = [0.1, 0.5, 0.9];
      const MEDIA_SELECTOR = 'img,video,canvas,svg,iframe,object,embed';
      const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
      const parseColor = (value) => {
        if (!value || value === 'transparent' || value === 'none') return null;
        const rgba = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[,/]\s*([\d.]+%?|[\d.]+))?\s*\)$/i);
        if (!rgba) return null;
        const alphaRaw = rgba[4] ?? '1';
        const alpha = alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
        return {r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: clamp(alpha)};
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
      const luminance = (color) => {
        const c = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return (0.2126 * c(color.r)) + (0.7152 * c(color.g)) + (0.0722 * c(color.b));
      };
      const contrast = (a, b) => { const hi = Math.max(luminance(a), luminance(b)); const lo = Math.min(luminance(a), luminance(b)); return (hi + 0.05) / (lo + 0.05); };
      const sampleElement = (element, canvas) => {
        const layers = [];
        let current = element;
        while (current) {
          const style = getComputedStyle(current);
          if (style.backgroundImage !== 'none') return null;
          const color = parseColor(style.backgroundColor);
          if (color && color.a > 0) layers.push(color);
          current = current.parentElement;
        }
        let background = canvas;
        for (const layer of layers.reverse()) background = composite(layer, background);
        const foreground = parseColor(getComputedStyle(element).color);
        return foreground ? {background, foreground} : null;
      };
      const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
      const computedScheme = getComputedStyle(document.documentElement).colorScheme.trim().toLowerCase();
      const metaScheme = document.querySelector('meta[name="color-scheme" i]')?.content.trim().toLowerCase() ?? '';
      const selected = computedScheme === 'normal' ? metaScheme : computedScheme;
      const tokens = selected.split(/\s+/).filter((token) => token && token !== 'only');
      const negotiatedDark = tokens.includes('dark') && (!tokens.includes('light') || prefersDark);
      const canvas = negotiatedDark ? {r: 18, g: 18, b: 18, a: 1} : {r: 255, g: 255, b: 255, a: 1};
      const width = Math.max(document.documentElement.clientWidth, innerWidth);
      const height = Math.max(document.documentElement.clientHeight, innerHeight);
      let known = 0; let dark = 0; let light = 0; let coherentDark = 0; let coherentLight = 0;
      const points = [];
      for (const xRatio of GRID) for (const yRatio of GRID) {
        const candidates = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(width * xRatio, height * yRatio) : [];
        const element = candidates.find((candidate) => !candidate.matches('[data-semantic-dark-sheet],[data-semantic-dark-ui]') && !candidate.closest('[data-semantic-dark-ui]'));
        if (!element || element.closest(MEDIA_SELECTOR)) { points.push({xRatio, yRatio, skipped: true, reason: !element ? 'no-element' : 'media'}); continue; }
        const sample = sampleElement(element, canvas);
        if (!sample) { points.push({xRatio, yRatio, tag: element.tagName, skipped: true, reason: 'background-image-or-no-foreground'}); continue; }
        const backgroundLuminance = luminance(sample.background);
        const foregroundLuminance = luminance(sample.foreground);
        const ratio = contrast(sample.foreground, sample.background);
        let bucket = 'mid';
        if (backgroundLuminance <= DARK_LUMINANCE) { dark++; bucket = 'dark'; if (foregroundLuminance > backgroundLuminance && ratio >= 3) coherentDark++; }
        else if (backgroundLuminance >= LIGHT_LUMINANCE) { light++; bucket = 'light'; if (foregroundLuminance < backgroundLuminance && ratio >= 3) coherentLight++; }
        known++;
        points.push({xRatio, yRatio, tag: element.tagName, className: element.className?.toString().slice(0, 80), background_luminance: Number(backgroundLuminance.toFixed(4)), foreground_luminance: Number(foregroundLuminance.toFixed(4)), contrast: Number(ratio.toFixed(3)), bucket});
      }
      const rootDarkMarker = [...document.documentElement.classList, ...document.body ? [...document.body.classList] : []].some((token) => ['dark', 'dark-mode', 'theme-dark', 'is-dark'].includes(token.toLowerCase())) || ['data-theme', 'data-bs-theme', 'data-color-mode', 'data-color-theme', 'data-mode', 'data-dark-mode'].some((attr) => [document.documentElement, document.body].some((el) => (el?.getAttribute(attr) ?? '').toLowerCase().split(/[\s_:.-]+/).includes('dark')));
      const evidence = {forcedColors: matchMedia('(forced-colors: active)').matches, negotiatedDark, rootDarkMarker, knownSamples: known, darkCoverage: known ? dark / known : 0, lightCoverage: known ? light / known : 0, lightOnDarkCoherence: dark ? coherentDark / dark : 0, darkOnLightCoherence: light ? coherentLight / light : 0};
      const strongDark = evidence.knownSamples >= 5 && ((evidence.darkCoverage >= 0.65 && evidence.lightOnDarkCoherence >= 0.55) || evidence.darkCoverage >= 0.78);
      const strongLight = evidence.knownSamples >= 5 && evidence.lightCoverage >= 0.7 && evidence.darkCoverage <= 0.2 && evidence.darkOnLightCoherence >= 0.55;
      const kind = evidence.forcedColors ? 'forced-colors' : strongDark ? 'native-dark' : evidence.rootDarkMarker ? (strongLight ? 'ambiguous' : 'native-dark') : evidence.negotiatedDark && !strongLight && (evidence.darkCoverage >= 0.4 || evidence.knownSamples === 0) ? 'native-dark' : strongLight ? 'light' : 'ambiguous';
      return {url: location.href, color_scheme: computedScheme, meta_scheme: metaScheme, prefersDark, evidence, strongDark, strongLight, kind, points};
    });
    output.push({site_id: site.id, status: response?.status() ?? null, error, evidence});
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    output.push({site_id: site.id, status: response?.status() ?? null, error});
  } finally {
    await page.close();
  }
}
await browser.close();
const outputPath = process.argv[3] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/metrics/native-dark-diagnostics.v1.json';
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
