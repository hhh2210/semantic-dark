import {readFile} from 'node:fs/promises';
import {
  assignCrossSiteSplit,
  familyOf,
  validateCrossSiteManifest,
  type CrossSiteRecord,
  type CrossSiteSplit,
  type ExpectedLayer,
  type AccessRisk,
} from './split';

export interface CrossSiteManifest {
  schema: string;
  created_at?: string;
  viewport?: {width: number; height: number; device_scale_factor: number};
  capture_policy?: string;
  split_policy?: string;
  site_count: number;
  counts?: unknown;
  sites: CrossSiteRecord[];
}

export interface UrlRepair {
  id: string;
  url: string;
  reason: string;
}

export interface LabelReview {
  id: string;
  from?: ExpectedLayer;
  to?: ExpectedLayer;
  status: 'proposed' | 'applied';
  reason: string;
}

export interface ReplacementQueueItem {
  replaces: string;
  page_type: string;
  status: 'needs-preflight' | 'accepted' | 'rejected';
  notes: string;
  candidates: Array<{id: string; url: string; reason: string}>;
}

export interface NewCrossSiteSite {
  id: string;
  url: string;
  expected_layer: ExpectedLayer;
  family: string;
  site_family?: string;
  page_type: string;
  features: string[];
  access_risk: AccessRisk;
  reason: string;
  source: string;
  host?: string;
  split?: CrossSiteSplit;
}

export interface CrossSiteSupplement {
  schema: string;
  base_schema: string;
  created_at?: string;
  purpose?: string;
  url_repairs: UrlRepair[];
  label_reviews: LabelReview[];
  quality_core_ids: string[];
  new_sites: NewCrossSiteSite[];
  replacement_queue: ReplacementQueueItem[];
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function loadCrossSiteManifest(path: string): Promise<CrossSiteManifest> {
  const manifest = await readJsonFile<CrossSiteManifest>(path);
  if (!Array.isArray(manifest.sites)) throw new Error(`Manifest has no sites array: ${path}`);
  return manifest;
}

export async function mergeCrossSiteSupplement(
  basePath: string,
  supplementPath: string,
): Promise<CrossSiteManifest> {
  const base = await loadCrossSiteManifest(basePath);
  const supplement = await readJsonFile<CrossSiteSupplement>(supplementPath);
  const byId = new Map(base.sites.map((site) => [site.id, {...site}]));
  const sentinelFamilies = new Set(
    base.sites.filter((site) => site.split === 'sentinel').map((site) => familyOf(site)),
  );
  const familySplit = new Map<string, CrossSiteSplit>();
  for (const site of base.sites) familySplit.set(familyOf(site), site.split);
  const qualityCore = new Set(supplement.quality_core_ids);

  for (const repair of supplement.url_repairs) {
    const site = byId.get(repair.id);
    if (!site) throw new Error(`URL repair targets unknown site: ${repair.id}`);
    site.url = repair.url;
    site.host = new URL(repair.url).hostname.replace(/^www\./, '');
    site.reason = `${site.reason} URL repaired: ${repair.reason}`.trim();
  }

  for (const review of supplement.label_reviews) {
    if (review.status !== 'applied' || !review.to) continue;
    const site = byId.get(review.id);
    if (!site) throw new Error(`Label review targets unknown site: ${review.id}`);
    site.expected_layer = review.to;
    site.label_status = 'reviewed';
  }

  for (const site of supplement.new_sites) {
    if (byId.has(site.id)) throw new Error(`New site reuses an existing id: ${site.id}`);
    const family = familyOf(site);
    const split = familySplit.get(family) ?? assignCrossSiteSplit(family, sentinelFamilies);
    if (site.split && site.split !== split) {
      throw new Error(`New site ${site.id} split ${site.split} disagrees with family ${family} -> ${split}`);
    }
    familySplit.set(family, split);
    byId.set(site.id, {
      ...site,
      site_family: family,
      split,
      source: site.source || 'v3-supplement',
      host: site.host || new URL(site.url).hostname.replace(/^www\./, ''),
    });
  }

  const sites = [...byId.values()].map((site) => ({
    ...site,
    quality_core: qualityCore.has(site.id),
    label_status: site.label_status ?? 'prior',
  }));
  const validation = validateCrossSiteManifest(sites);
  if (!validation.valid) {
    throw new Error(`Merged cross-site manifest is invalid: ${JSON.stringify({
      duplicateIds: validation.duplicateIds,
      familySplitViolations: validation.familySplitViolations,
      invalidUrls: validation.invalidUrls,
    })}`);
  }

  const merged: CrossSiteManifest = {
    schema: 'semantic-dark.cross-site-sites.v3',
    site_count: sites.length,
    split_policy: `${base.split_policy ?? 'v2 family hash'}; v3 supplement merged without splitting a family`,
    sites,
  };
  const createdAt = supplement.created_at ?? base.created_at;
  if (createdAt) merged.created_at = createdAt;
  if (base.viewport) merged.viewport = base.viewport;
  if (base.capture_policy) merged.capture_policy = base.capture_policy;
  return merged;
}
