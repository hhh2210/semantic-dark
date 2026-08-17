import {readFile, writeFile} from 'node:fs/promises';

const manifestPath = process.argv[2] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/sites-expanded.v1.json';
const outputPath = process.argv[3] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/preflight-expanded.v1.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sites = manifest.sites ?? [];
const concurrency = 8;
const timeoutMs = 12_000;
const results = new Array(sites.length);
let cursor = 0;

async function check(site) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    let response = await fetch(site.url, {method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: {'user-agent': 'semantic-dark-benchmark-preflight/1.0'}});
    if (response.status === 405 || response.status === 403 || response.status === 429) {
      response = await fetch(site.url, {method: 'GET', redirect: 'follow', signal: controller.signal, headers: {'user-agent': 'semantic-dark-benchmark-preflight/1.0', accept: 'text/html'}});
    }
    return {
      ...site,
      preflight_status: response.status,
      preflight_ok: response.status >= 200 && response.status < 400,
      final_url: response.url,
      final_host: new URL(response.url).hostname,
      elapsed_ms: Date.now() - started,
      exclude_reason: response.status >= 200 && response.status < 400 ? null : `http-${response.status}`,
    };
  } catch (error) {
    return {
      ...site,
      preflight_status: null,
      preflight_ok: false,
      final_url: null,
      final_host: null,
      elapsed_ms: Date.now() - started,
      exclude_reason: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= sites.length) return;
    results[index] = await check(sites[index]);
    console.log(`[${index + 1}/${sites.length}] ${results[index].preflight_status ?? 'ERR'} ${sites[index].id}`);
  }
}
await Promise.all(Array.from({length: concurrency}, worker));
const summary = {
  schema: 'semantic-dark.cross-site-preflight.v1',
  captured_at: new Date().toISOString(),
  manifest: manifestPath,
  site_count: results.length,
  ok_count: results.filter((x) => x.preflight_ok).length,
  excluded_count: results.filter((x) => !x.preflight_ok).length,
  by_status: Object.fromEntries([...new Set(results.map((x) => String(x.preflight_status ?? 'error')))].sort().map((key) => [key, results.filter((x) => String(x.preflight_status ?? 'error') === key).length])),
  sites: results,
};
await writeFile(outputPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({site_count: summary.site_count, ok_count: summary.ok_count, excluded_count: summary.excluded_count, by_status: summary.by_status}, null, 2));
