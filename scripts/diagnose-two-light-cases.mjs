import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const outputPath = process.argv[2] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/two-case-live-diagnostics.v1.json';
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const sites = [
  {id: 'light-arxiv', url: 'https://arxiv.org/'},
  {id: 'openstax', url: 'https://openstax.org/'},
];
const waits = [800, 2500];
const browser = await chromium.launch({executablePath: chromePath, headless: true});
const output = [];
for (const site of sites) {
  for (const settleMs of waits) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, colorScheme: 'dark', ignoreHTTPSErrors: true});
    const page = await context.newPage();
    let response = null;
    let navigationError = null;
    try {
      response = await page.goto(site.url, {waitUntil: 'commit', timeout: 15000});
      await page.waitForTimeout(settleMs);
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
          return {r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha, g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha, b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha, a: alpha};
        };
        const luminance = (color) => { const c = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return (0.2126 * c(color.r)) + (0.7152 * c(color.g)) + (0.0722 * c(color.b)); };
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
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = document.body ? getComputedStyle(document.body) : null;
        const computedScheme = rootStyle.colorScheme.trim().toLowerCase();
        const metaScheme = document.querySelector('meta[name="color-scheme" i]')?.content.trim().toLowerCase() ?? '';
        const selected = computedScheme === 'normal' ? metaScheme : computedScheme;
        const tokens = selected.split(/\s+/).filter((token) => token && token !== 'only');
        const negotiatedDark = tokens.includes('dark') && (!tokens.includes('light') || prefersDark);
        const declaredLight = tokens.includes('light') && (!tokens.includes('dark') || !prefersDark);
        const lightCanvas = [document.body, document.documentElement].some((element) => {
          if (!element) return false;
          const color = parseColor(getComputedStyle(element).backgroundColor);
          return Boolean(color && color.a >= 0.9 && luminance(color) >= LIGHT_LUMINANCE);
        });
        const width = Math.max(document.documentElement.clientWidth, innerWidth);
        const height = Math.max(document.documentElement.clientHeight, innerHeight);
        const points = [];
        let known = 0; let dark = 0; let light = 0; let coherentDark = 0; let coherentLight = 0;
        for (const xRatio of GRID) for (const yRatio of GRID) {
          const candidates = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(width * xRatio, height * yRatio) : [];
          const element = candidates.find((candidate) => !candidate.matches('[data-semantic-dark-sheet],[data-semantic-dark-ui]') && !candidate.closest('[data-semantic-dark-ui]'));
          if (!element || element.closest(MEDIA_SELECTOR)) { points.push({xRatio, yRatio, skipped: true, reason: !element ? 'no-element' : 'media'}); continue; }
          const sample = sampleElement(element, negotiatedDark ? {r: 18, g: 18, b: 18, a: 1} : {r: 255, g: 255, b: 255, a: 1});
          if (!sample) { points.push({xRatio, yRatio, tag: element.tagName, skipped: true, reason: 'background-image-or-no-foreground'}); continue; }
          const bgLum = luminance(sample.background);
          const fgLum = luminance(sample.foreground);
          const ratio = contrast(sample.foreground, sample.background);
          let bucket = 'mid';
          if (bgLum <= DARK_LUMINANCE) { dark += 1; bucket = 'dark'; if (fgLum > bgLum && ratio >= 3) coherentDark += 1; }
          else if (bgLum >= LIGHT_LUMINANCE) { light += 1; bucket = 'light'; if (fgLum < bgLum && ratio >= 3) coherentLight += 1; }
          known += 1;
          points.push({xRatio, yRatio, tag: element.tagName, class_name: String(element.className ?? '').slice(0, 80), background_luminance: Number(bgLum.toFixed(4)), foreground_luminance: Number(fgLum.toFixed(4)), contrast: Number(ratio.toFixed(3)), bucket});
        }
        const rootDarkMarker = [...document.documentElement.classList, ...(document.body ? [...document.body.classList] : [])].some((token) => ['dark', 'dark-mode', 'theme-dark', 'is-dark'].includes(token.toLowerCase())) || ['data-theme', 'data-bs-theme', 'data-color-mode', 'data-color-theme', 'data-mode', 'data-dark-mode'].some((attr) => [document.documentElement, document.body].some((el) => (el?.getAttribute(attr) ?? '').toLowerCase().split(/[\s_:.-]+/).includes('dark')));
        const evidence = {forcedColors: matchMedia('(forced-colors: active)').matches, negotiatedDark, declaredLight, lightCanvas, rootDarkMarker, knownSamples: known, darkCoverage: known ? dark / known : 0, lightCoverage: known ? light / known : 0, lightOnDarkCoherence: dark ? coherentDark / dark : 0, darkOnLightCoherence: light ? coherentLight / light : 0};
        const strongDark = evidence.knownSamples >= 5 && ((evidence.darkCoverage >= 0.65 && evidence.lightOnDarkCoherence >= 0.55) || evidence.darkCoverage >= 0.78);
        const strongLight = evidence.knownSamples >= 4 && evidence.lightCoverage >= 0.7 && evidence.darkCoverage <= 0.2 && evidence.darkOnLightCoherence >= 0.55;
        const explicitLight = evidence.declaredLight && evidence.lightCanvas && !evidence.negotiatedDark && !evidence.rootDarkMarker && (evidence.knownSamples === 0 || (evidence.lightCoverage >= 0.5 && evidence.darkCoverage < 0.4));
        const kind = evidence.forcedColors ? 'forced-colors' : strongDark ? 'native-dark' : evidence.rootDarkMarker ? (strongLight ? 'ambiguous' : 'native-dark') : evidence.negotiatedDark && !strongLight && (evidence.darkCoverage >= 0.4 || evidence.knownSamples === 0) ? 'native-dark' : strongLight ? 'light' : explicitLight ? 'light' : 'ambiguous';
        return {location: location.href, title: document.title, ready_state: document.readyState, root_background: rootStyle.backgroundColor, body_background: bodyStyle?.backgroundColor ?? null, root_color: rootStyle.color, body_color: bodyStyle?.color ?? null, computed_scheme: computedScheme, meta_scheme: metaScheme, prefersDark, body_child_count: document.body?.children.length ?? 0, visible_elements: [...document.querySelectorAll('body *')].filter((element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; }).length, evidence, strongDark, strongLight, explicitLight, kind, points};
      });
      output.push({site_id: site.id, settle_ms: settleMs, status: response?.status() ?? null, navigation_error: null, evidence});
    } catch (error) {
      output.push({site_id: site.id, settle_ms: settleMs, status: response?.status() ?? null, navigation_error: error instanceof Error ? error.message : String(error)});
    } finally { await context.close(); }
  }
}
await browser.close();
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
