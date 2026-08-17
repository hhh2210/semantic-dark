import {readFile, writeFile} from 'node:fs/promises';

const manifestPath = '/home/ubuntu/scratch-data/semantic-dark-cross-site/sites-expanded-preflight.v1.json';
const partialPath = '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-full/metrics/site-observations.expanded.v1.jsonl';
const resumePath = '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-resume/metrics/site-observations.resume.v1.jsonl';
const outputPath = '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-final/site-observations.expanded.v1.jsonl';
const summaryPath = '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-final/site-summary.expanded.v1.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const parseJsonl = async (path) => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const rows = [...await parseJsonl(partialPath), ...await parseJsonl(resumePath)];
const byId = new Map(rows.map((row) => [row.site_id, row]));
const ap = manifest.sites.find((site) => site.id === 'ap-news');
if (ap && !byId.has(ap.id)) {
  byId.set(ap.id, {
    schema: 'semantic-dark.cross-site-observation.v1',
    ...ap,
    viewport: manifest.viewport,
    capture_policy: manifest.capture_policy,
    captured_at: new Date().toISOString(),
    content_eligible: false,
    exclude_reason: 'browser-hard-timeout-after-commit',
    baseline: {navigation_error: 'browser-hard-timeout-after-commit', status: null, url: ap.url, console_error_count: 0, page_error_count: 0},
    extension: {navigation_error: 'browser-hard-timeout-after-commit', status: null, url: ap.url, console_error_count: 0, page_error_count: 0},
  });
}
const ordered = manifest.sites.map((site) => byId.get(site.id)).filter(Boolean);
await writeFile(outputPath, ordered.map((row) => JSON.stringify(row)).join('\n') + '\n');

const count = (items, predicate) => items.filter(predicate).length;
const byField = (field, items = ordered) => Object.fromEntries([...new Set(items.map((x) => x[field] ?? 'unknown'))].sort().map((key) => [key, items.filter((x) => (x[field] ?? 'unknown') === key).length]));
const observations = ordered.map((row) => ({
  site_id: row.site_id,
  family: row.family,
  site_family: row.site_family,
  page_type: row.page_type,
  split: row.split,
  source: row.source,
  access_risk: row.access_risk,
  expected_layer: row.expected_layer,
  observed_authored_dark_like: row.dark_baseline?.authored_dark_like ?? null,
  dark_activation: row.dark_activation ?? null,
  algorithm_noop: row.algorithm_noop ?? null,
  expected_activation: row.expected_activation ?? null,
  activation_match: row.activation_match ?? null,
  native_dark_decision: row.native_dark_decision ?? null,
  restore_equal: row.restore_equal ?? null,
  browser_loaded: Boolean(row.content_eligible && row.extension?.status >= 200 && row.extension?.status < 400),
  browser_status: row.extension?.status ?? null,
  host: row.extension?.url ? new URL(row.extension.url).host : new URL(row.url).host,
  excluded: row.content_eligible === false,
  error: row.extension_error ?? row.exclude_reason ?? row.baseline?.navigation_error ?? null,
}));
const eligible = ordered.filter((row) => row.content_eligible && row.extension?.status >= 200 && row.extension?.status < 400);
const layerSummary = Object.fromEntries([...new Set(ordered.map((x) => x.expected_layer))].sort().map((layer) => {
  const items = ordered.filter((x) => x.expected_layer === layer);
  return [layer, {
    count: items.length,
    browser_loaded: count(items, (x) => x.content_eligible && x.extension?.status >= 200 && x.extension?.status < 400),
    active: count(items, (x) => x.dark_activation === true),
    noop: count(items, (x) => x.algorithm_noop === true),
    activation_match: count(items, (x) => x.activation_match === true),
    restore_equal: count(items, (x) => x.restore_equal === true),
  }];
}));
const splitSummary = Object.fromEntries([...new Set(ordered.map((x) => x.split ?? 'unknown'))].sort().map((split) => {
  const items = ordered.filter((x) => (x.split ?? 'unknown') === split);
  return [split, {count: items.length, browser_loaded: count(items, (x) => x.content_eligible && x.extension?.status >= 200 && x.extension?.status < 400), active: count(items, (x) => x.dark_activation === true), restore_equal: count(items, (x) => x.restore_equal === true)}];
}));
const summary = {
  schema: 'semantic-dark.cross-site-summary.v2',
  captured_at: new Date().toISOString(),
  manifest: manifestPath,
  output: outputPath,
  site_count: ordered.length,
  preflight_passed_count: manifest.sites.length,
  browser_loaded_count: eligible.length,
  browser_excluded_count: count(ordered, (x) => x.content_eligible === false),
  active_count: count(ordered, (x) => x.dark_activation === true),
  native_dark_decision_count: count(ordered, (x) => x.native_dark_decision === true),
  restore_equal_count: count(ordered, (x) => x.restore_equal === true),
  extension_errors: count(ordered, (x) => Boolean(x.extension_error)),
  activation_match_count: count(ordered, (x) => x.activation_match === true),
  activation_match_denominator: count(ordered, (x) => x.activation_match !== null && x.activation_match !== undefined),
  by_expected_layer: layerSummary,
  by_split: splitSummary,
  by_page_type: byField('page_type'),
  by_access_risk: byField('access_risk'),
  browser_exclusions: observations.filter((x) => x.excluded).map((x) => ({site_id: x.site_id, host: x.host, error: x.error})),
  restore_failures: observations.filter((x) => x.restore_equal === false).map((x) => x.site_id),
  native_dark_activations: observations.filter((x) => x.expected_layer === 'native-dark' && x.dark_activation === true).map((x) => x.site_id),
  light_noops: observations.filter((x) => x.expected_layer === 'light-only' && x.browser_loaded && x.dark_activation === false).map((x) => x.site_id),
  observations,
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({site_count: summary.site_count, browser_loaded: summary.browser_loaded_count, browser_excluded: summary.browser_excluded_count, active: summary.active_count, native_dark_activations: summary.native_dark_activations, restore_failures: summary.restore_failures}, null, 2));
