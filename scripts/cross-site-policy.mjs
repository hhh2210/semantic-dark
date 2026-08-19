import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CROSS_SITE_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const CONSENT_BUTTON_LABELS = [
  'accept all',
  'accept',
  'i agree',
  'agree',
  'allow all',
  'allow cookies',
  'got it',
  'ok',
];

export const DEFAULT_V2_MANIFEST = path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v2.json');
export const DEFAULT_V3_MANIFEST = path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3.json');
export const DEFAULT_V3_SUPPLEMENT = path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3-supplement.json');
