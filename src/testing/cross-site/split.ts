export type CrossSiteSplit = 'sentinel' | 'core' | 'held-out';
export type ExpectedLayer = 'native-dark' | 'light-only' | 'dynamic-mixed';
export type AccessRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface CrossSiteRecord {
  id: string;
  url: string;
  expected_layer: ExpectedLayer;
  family: string;
  site_family: string;
  page_type: string;
  features: string[];
  access_risk: AccessRisk;
  reason: string;
  source: string;
  host: string;
  split: CrossSiteSplit;
  quality_core?: boolean;
  label_status?: 'prior' | 'reviewed' | 'needs-review';
}

export interface FamilySplitViolation {
  family: string;
  splits: CrossSiteSplit[];
  ids: string[];
}

export interface ManifestValidation {
  valid: boolean;
  siteCount: number;
  uniqueIds: number;
  uniqueHosts: number;
  duplicateIds: string[];
  emptyIds: string[];
  invalidUrls: string[];
  invalidFields: string[];
  familySplitViolations: FamilySplitViolation[];
}

const SPLITS = new Set<CrossSiteSplit>(['sentinel', 'core', 'held-out']);
const LAYERS = new Set<ExpectedLayer>(['native-dark', 'light-only', 'dynamic-mixed']);

/** FNV-1a 32-bit. v2 assigned held-out when hash % 100 < 20. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function assignCrossSiteSplit(
  siteFamily: string,
  sentinelFamilies: ReadonlySet<string>,
): CrossSiteSplit {
  if (sentinelFamilies.has(siteFamily)) return 'sentinel';
  return fnv1a32(siteFamily) % 100 < 20 ? 'held-out' : 'core';
}

export function familyOf(site: {family: string; site_family?: string}): string {
  return site.site_family || site.family;
}

export function validateCrossSiteManifest(sites: readonly CrossSiteRecord[]): ManifestValidation {
  const ids = new Map<string, number>();
  const hosts = new Map<string, string[]>();
  const families = new Map<string, {splits: Set<CrossSiteSplit>; ids: string[]}>();
  const emptyIds: string[] = [];
  const invalidUrls: string[] = [];
  const invalidFields: string[] = [];

  for (const site of sites) {
    if (!site.id.trim()) emptyIds.push(site.id);
    ids.set(site.id, (ids.get(site.id) ?? 0) + 1);
    const hostIds = hosts.get(site.host) ?? [];
    hostIds.push(site.id);
    hosts.set(site.host, hostIds);
    if (!isHttpUrl(site.url)) invalidUrls.push(site.id);
    if (!SPLITS.has(site.split) || !LAYERS.has(site.expected_layer)) invalidFields.push(site.id);
    const family = familyOf(site);
    const bucket = families.get(family) ?? {splits: new Set<CrossSiteSplit>(), ids: []};
    bucket.splits.add(site.split);
    bucket.ids.push(site.id);
    families.set(family, bucket);
  }

  const duplicateIds = [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const familySplitViolations = [...families.entries()]
    .filter(([, bucket]) => bucket.splits.size > 1)
    .map(([family, bucket]) => ({
      family,
      splits: [...bucket.splits].sort() as CrossSiteSplit[],
      ids: bucket.ids,
    }));

  return {
    valid: duplicateIds.length === 0 && emptyIds.length === 0 && invalidUrls.length === 0 &&
      invalidFields.length === 0 && familySplitViolations.length === 0,
    siteCount: sites.length,
    uniqueIds: ids.size,
    uniqueHosts: hosts.size,
    duplicateIds,
    emptyIds,
    invalidUrls,
    invalidFields,
    familySplitViolations,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
