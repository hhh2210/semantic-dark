import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const outputPath = process.argv[2] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/extension-case-diagnostics.v1.json';
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const extensionDir = path.resolve(new URL('.', import.meta.url).pathname, '..', 'dist');
const sites = [
  {id: 'light-arxiv', url: 'https://arxiv.org/'},
  {id: 'openstax', url: 'https://openstax.org/'},
];
const settleMs = Number(process.env.SEMANTIC_DARK_SETTLE_MS ?? 5000);
const output = [];
for (const site of sites) {
  const profile = `/tmp/semantic-dark-case-${site.id}-${Date.now()}`;
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromePath,
    headless: true,
    viewport: {width: 1440, height: 900},
    colorScheme: 'dark',
    ignoreHTTPSErrors: true,
    args: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch,DisableDisableExtensionsExceptCommandLineSwitch',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });
  const page = await context.newPage();
  let response = null;
  let error = null;
  try {
    response = await page.goto(site.url, {waitUntil: 'commit', timeout: 15000});
    await page.waitForTimeout(settleMs);
    const observation = await page.evaluate(() => {
      const parse = (value) => {
        const m = String(value).match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      };
      const lum = ([r, g, b]) => {
        const channel = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const visible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0; };
      const darkText = [];
      const textElements = [...document.querySelectorAll('body *')].filter(visible).filter((element) => (element.textContent ?? '').trim().length > 0);
      for (const element of textElements) {
        const style = getComputedStyle(element);
        const color = parse(style.color);
        const bg = parse(style.backgroundColor);
        if (!color) continue;
        const background = bg && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bg : parse(getComputedStyle(element.parentElement ?? document.body).backgroundColor) ?? [17,20,22];
        if (lum(color) < 0.08 && lum(background) < 0.15) {
          darkText.push({tag: element.tagName, id: element.id, class_name: String(element.className ?? '').slice(0, 160), text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 160), color: style.color, background: style.backgroundColor, marker: [...element.attributes].filter((attr) => attr.name.startsWith('data-semantic-dark')).map((attr) => attr.name), inline_style: element.getAttribute('style')?.slice(0, 240) ?? null});
        }
      }
      const active = document.documentElement.hasAttribute('data-semantic-dark-active');
      const sampleNodes = [...document.querySelectorAll('p,h1,h2,h3,strong,a')].filter(visible).slice(0, 20).map((element) => ({
        tag: element.tagName,
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        child_node_types: [...element.childNodes].map((node) => node.nodeType),
        own_style_color: element.style.color,
        computed_color: getComputedStyle(element).color,
        computed_background: getComputedStyle(element).backgroundColor,
        text_decoration_line: getComputedStyle(element).textDecorationLine,
        caret_color: getComputedStyle(element).caretColor,
        has_color_marker: element.hasAttribute('data-semantic-dark-color'),
        has_decoration_marker: element.hasAttribute('data-semantic-dark-decoration'),
        parent_tag: element.parentElement?.tagName ?? null,
        parent_has_color_marker: element.parentElement?.hasAttribute('data-semantic-dark-color') ?? false,
        parent_computed_color: element.parentElement ? getComputedStyle(element.parentElement).color : null,
        semantic_color_var: element.style.getPropertyValue('--semantic-dark-color'),
      }));
      return {url: location.href, title: document.title, ready_state: document.readyState, active, marker_count: document.querySelectorAll('[data-semantic-dark-active],[data-semantic-dark-color],[data-semantic-dark-background]').length, body_child_count: document.body?.children.length ?? 0, visible_element_count: textElements.length, dark_text_count: darkText.length, dark_text: darkText.slice(0, 40), sample_nodes: sampleNodes, root_background: getComputedStyle(document.documentElement).backgroundColor, body_background: getComputedStyle(document.body).backgroundColor, body_color: getComputedStyle(document.body).color};
    });
    output.push({site_id: site.id, status: response?.status() ?? null, settle_ms: settleMs, error: null, observation});
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    output.push({site_id: site.id, status: response?.status() ?? null, settle_ms: settleMs, error});
  } finally {
    await context.close().catch(() => undefined);
  }
}
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
