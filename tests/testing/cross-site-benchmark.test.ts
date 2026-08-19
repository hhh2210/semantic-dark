import {describe, expect, it} from 'vitest';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {
  assignCrossSiteSplit,
  familyOf,
  fnv1a32,
  mergeCrossSiteSupplement,
  summarizeQualityPanels,
  validateCrossSiteManifest,
  type CrossSiteRecord,
} from '../../src/testing/cross-site';

const ROOT = path.resolve(import.meta.dirname, '../..');
const V2 = path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v2.json');
const SUPPLEMENT = path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3-supplement.json');
const EXCLUSIONS = path.join(ROOT, 'fixtures/evaluation/cross-site-exclusions.v1.json');

async function loadJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

describe('cross-site v2 manifest', () => {
  it('keeps unique ids and family-disjoint splits', async () => {
    const manifest = await loadJson<{sites: CrossSiteRecord[]}>(V2);
    const validation = validateCrossSiteManifest(manifest.sites);
    expect(validation).toMatchObject({
      valid: true,
      siteCount: 154,
      duplicateIds: [],
      familySplitViolations: [],
    });
  });

  it('reproduces the v2 held-out assignment from FNV-1a % 100 < 20', async () => {
    const manifest = await loadJson<{sites: CrossSiteRecord[]}>(V2);
    const sentinelFamilies = new Set(
      manifest.sites.filter((site) => site.split === 'sentinel').map((site) => familyOf(site)),
    );
    for (const site of manifest.sites) {
      if (site.split === 'sentinel') continue;
      expect(assignCrossSiteSplit(familyOf(site), sentinelFamilies), site.id).toBe(site.split);
    }
    expect(fnv1a32('mediawiki') % 100).toBeLessThan(20);
  });
});

describe('cross-site v3 supplement', () => {
  it('merges URL repairs and new families without split leakage', async () => {
    const merged = await mergeCrossSiteSupplement(V2, SUPPLEMENT);
    const ikea = merged.sites.find((site) => site.id === 'ikea-sofas');
    expect(ikea?.url).toBe('https://www.ikea.com/us/en/');
    expect(merged.sites.some((site) => site.id === 'rfc-editor')).toBe(true);
    expect(merged.sites.filter((site) => site.id === 'rfc-editor')[0]?.quality_core).toBe(true);
    const validation = validateCrossSiteManifest(merged.sites);
    expect(validation.valid).toBe(true);
    expect(merged.site_count).toBe(manifestLengthPlusNew());
  });

  it('applies only independently verified label reviews during merge', async () => {
    const merged = await mergeCrossSiteSupplement(V2, SUPPLEMENT);
    const python = merged.sites.find((site) => site.id === 'light-python');
    const aws = merged.sites.find((site) => site.id === 'aws-documentation');
    expect(python?.expected_layer).toBe('light-only');
    expect(python?.label_status).toBe('reviewed');
    expect(aws?.expected_layer).toBe('dynamic-mixed');
    expect(aws?.label_status).toBe('reviewed');
  });

  it('keeps the checked-in v3 manifest identical to a fresh merge', async () => {
    const merged = await mergeCrossSiteSupplement(V2, SUPPLEMENT);
    const checkedIn = await loadJson<{site_count: number; sites: CrossSiteRecord[]}>(
      path.join(ROOT, 'fixtures/evaluation/cross-site-sites.v3.json'),
    );
    expect(checkedIn.site_count).toBe(merged.site_count);
    expect(checkedIn.sites.map((site) => [site.id, site.url, site.split, site.expected_layer]))
      .toEqual(merged.sites.map((site) => [site.id, site.url, site.split, site.expected_layer]));
  });
});

describe('quality panels', () => {
  it('scores coverage on measured light-stable pages, not prior labels', () => {
    const panels = summarizeQualityPanels([
      {
        site_id: 'stable-light',
        expected_layer: 'dynamic-mixed',
        content_eligible: true,
        extension: {status: 200},
        light_baseline: {authored_dark_like: false},
        dark_baseline: {authored_dark_like: false},
        dark_activation: true,
        restore_equal: true,
      },
      {
        site_id: 'mislabeled-light',
        expected_layer: 'light-only',
        content_eligible: true,
        extension: {status: 200},
        light_baseline: {authored_dark_like: false},
        dark_baseline: {authored_dark_like: true},
        dark_activation: false,
        restore_equal: true,
      },
      {
        site_id: 'native',
        expected_layer: 'native-dark',
        content_eligible: true,
        extension: {status: 200},
        light_baseline: {authored_dark_like: true},
        dark_baseline: {authored_dark_like: true},
        dark_activation: false,
        restore_equal: true,
      },
    ]);
    expect(panels.measuredLightStable).toEqual({
      denominator: 1,
      active: ['stable-light'],
      noop: [],
    });
    expect(panels.priorLightOnly.denominator).toBe(1);
    expect(panels.priorLightOnly.noop).toEqual(['mislabeled-light']);
    expect(panels.nativeDarkSafety.falseActivations).toEqual([]);
  });
});

describe('exclusion list', () => {
  it('only names ids that exist in v2', async () => {
    const manifest = await loadJson<{sites: CrossSiteRecord[]}>(V2);
    const exclusions = await loadJson<{sites: Array<{id: string}>}>(EXCLUSIONS);
    const ids = new Set(manifest.sites.map((site) => site.id));
    for (const site of exclusions.sites) expect(ids.has(site.id), site.id).toBe(true);
  });
});

function manifestLengthPlusNew(): number {
  return 154 + 15;
}
