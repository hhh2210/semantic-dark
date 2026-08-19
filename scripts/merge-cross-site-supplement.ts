import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeCrossSiteSupplement} from '../src/testing/cross-site/manifest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const basePath = process.argv[2] ?? path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v2.json');
const supplementPath = process.argv[3] ?? path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3-supplement.json');
const outputPath = process.argv[4] ?? path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3.json');

const merged = await mergeCrossSiteSupplement(basePath, supplementPath);
await mkdir(path.dirname(outputPath), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  site_count: merged.site_count,
  quality_core: merged.sites.filter((site) => site.quality_core).length,
  new_or_repaired: merged.sites.filter((site) => site.source === 'v3-supplement' || site.id === 'ikea-sofas').length,
}, null, 2));
