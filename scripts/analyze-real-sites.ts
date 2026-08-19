import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  loadCrossSiteManifest,
  summarizeQualityPanels,
  validateCrossSiteManifest,
  type CrossSiteObservation,
} from '../src/testing/cross-site';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonlPath = process.argv[2] ?? path.join(process.env.HOME ?? '/home/ubuntu', 'scratch-data/semantic-dark-cross-site/expanded-final/site-observations.expanded.v2.jsonl');
const manifestPath = process.argv[3] ?? path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3.json');
const outputPath = process.argv[4] ?? path.join(path.dirname(jsonlPath), 'quality-analysis.v3.json');

const manifest = await loadCrossSiteManifest(manifestPath);
const validation = validateCrossSiteManifest(manifest.sites);
const rows = (await readFile(jsonlPath, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as CrossSiteObservation);

const panels = summarizeQualityPanels(rows);
const result = {
  schema: 'semantic-dark.cross-site-quality-analysis.v3',
  generated_at: new Date().toISOString(),
  manifest: manifestPath,
  observations: jsonlPath,
  site_count: rows.length,
  manifest_validation: validation,
  ...panels,
  coverage_note: 'Primary coverage denominator is measuredLightStable, not prior light-only labels.',
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  site_count: result.site_count,
  loaded_count: panels.loadedCount,
  measured_light_stable: {
    denominator: panels.measuredLightStable.denominator,
    active: panels.measuredLightStable.active.length,
  },
  prior_light_only: {
    denominator: panels.priorLightOnly.denominator,
    active: panels.priorLightOnly.active.length,
  },
  native_dark_false_activations: panels.nativeDarkSafety.falseActivations,
  restore_failures: panels.restore.failureIds,
}, null, 2));
