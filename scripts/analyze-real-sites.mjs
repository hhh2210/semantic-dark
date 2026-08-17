import {readFile, writeFile} from 'node:fs/promises';

const manifestPath = process.argv[3] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/sites-expanded-preflight.v1.json';
const jsonlPath = process.argv[2] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-final/site-observations.expanded.v2.jsonl';
const outputPath = process.argv[4] ?? '/home/ubuntu/scratch-data/semantic-dark-cross-site/expanded-final/quality-analysis.v2.json';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const rows = (await readFile(jsonlPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const splitByFamily = new Map();
for (const site of manifest.sites) {
  const family = site.site_family ?? site.family;
  const splits = splitByFamily.get(family) ?? new Set();
  splits.add(site.split ?? 'unknown');
  splitByFamily.set(family, splits);
}
const splitViolations = [...splitByFamily.entries()].filter(([, splits]) => splits.size > 1).map(([family, splits]) => ({family, splits: [...splits]}));
function profile(row) {
  if (!row.content_eligible || !row.extension || !(row.extension.status >= 200 && row.extension.status < 400)) return 'unavailable';
  const light = row.light_baseline?.authored_dark_like;
  const dark = row.dark_baseline?.authored_dark_like;
  if (light === false && dark === false) return 'light-stable';
  if (light === false && dark === true) return 'system-dark-or-mixed';
  if (light === true && dark === true) return 'author-dark-static';
  if (light === true && dark === false) return 'system-light-or-ambiguous';
  return 'unknown';
}
const countBy = (items, fn) => Object.fromEntries([...new Set(items.map(fn))].sort().map((key) => [key, items.filter((x) => fn(x) === key).length]));
const loaded = rows.filter((row) => row.content_eligible && row.extension?.status >= 200 && row.extension?.status < 400);
const lightCandidate = loaded.filter((row) => profile(row) === 'light-stable');
const themeExpected = loaded.filter((row) => row.expected_layer === 'light-only');
const result = {
  schema: 'semantic-dark.cross-site-quality-analysis.v1',
  generated_at: new Date().toISOString(),
  manifest: manifestPath,
  observations: jsonlPath,
  site_count: rows.length,
  loaded_count: loaded.length,
  unavailable_count: rows.length - loaded.length,
  split_family_violation_count: splitViolations.length,
  split_family_violations: splitViolations,
  observed_theme_profile: countBy(loaded, profile),
  expected_layer_profile: countBy(loaded, (row) => row.expected_layer),
  light_stable_activation: {
    count: lightCandidate.length,
    active: lightCandidate.filter((row) => row.dark_activation === true).map((row) => row.site_id),
    noop: lightCandidate.filter((row) => row.dark_activation === false).map((row) => row.site_id),
  },
  expected_light_only_quality: {
    eligible: themeExpected.length,
    active: themeExpected.filter((row) => row.dark_activation === true).length,
    noop: themeExpected.filter((row) => row.dark_activation === false).length,
    restore_equal: themeExpected.filter((row) => row.restore_equal === true).length,
  },
  native_dark_safety: {
    loaded_expected_native: loaded.filter((row) => row.expected_layer === 'native-dark').length,
    active_expected_native: loaded.filter((row) => row.expected_layer === 'native-dark' && row.dark_activation === true).map((row) => row.site_id),
    native_decision_count: loaded.filter((row) => row.native_dark_decision === true).length,
  },
  restore: {
    equal_count: loaded.filter((row) => row.restore_equal === true).length,
    failure_ids: loaded.filter((row) => row.restore_equal === false).map((row) => row.site_id),
  },
  browser_exclusions: rows.filter((row) => row.content_eligible === false).map((row) => ({site_id: row.site_id, url: row.url, reason: row.exclude_reason ?? row.baseline?.navigation_error ?? 'unknown'})),
};
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
