import {build} from 'esbuild';
import {cp, mkdir, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});

await build({
  entryPoints: {
    content: resolve(root, 'src/content/index.ts'),
    'main-world': resolve(root, 'src/main-world.ts'),
    'service-worker': resolve(root, 'src/service-worker.ts'),
    'raster-worker': resolve(root, 'src/raster/worker.ts'),
    'raster-worker-host': resolve(root, 'src/raster/worker-host.ts'),
    popup: resolve(root, 'src/popup.ts'),
  },
  bundle: true,
  outdir: dist,
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  minify: false,
});

for (const file of [
  'manifest.json',
  'prepaint.css',
  'popup.html',
  'popup.css',
  'raster-worker-host.html',
]) {
  await cp(resolve(root, 'extension', file), resolve(dist, file));
}
await cp(resolve(root, 'extension', 'icons'), resolve(dist, 'icons'), {recursive: true});

console.log(`Built unpacked extension at ${dist}`);
