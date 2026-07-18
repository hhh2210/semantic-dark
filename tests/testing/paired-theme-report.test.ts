import {describe, expect, it} from 'vitest';

import {contrastFinding, rankFinding} from '../../src/testing/paired-theme/evaluation-support';
import {createPairedThemeReport, renderPairedThemeReportHtml} from '../../src/testing/paired-theme/report';
import type {PairedThemeSystemEvaluation} from '../../src/testing/paired-theme/evaluation-types';

function evaluation(system: 'material' | 'primer', e: number): PairedThemeSystemEvaluation {
  return {
    schema: 'semantic-dark.paired-theme-system-evaluation.v1', system, split: 'development', status: 'valid',
    counts: {scenes: 1, paintsPerVariant: 2, observations: 6, reviewedDecisions: 1,
      colorRows: 1, contrastRows: 1, rankPairs: 1, colorByRole: {text: 1}, contrastByRole: {text: 1}},
    rows: {color: [], contrast: [], rank: []},
    primary: {d: e, c: e, r: e, e, pairScore: 100 * (1 - e), relativeErrorReduction: {
      formula: '(E_baseline-E_candidate)/E_baseline', baselineE: e, candidateE: null,
      value: null, status: 'not-applicable-baseline-only'}},
    secondary: {contrastErrorRaw: e, surfaceRankInversionRate: 0,
      surfaceRankTieMismatchCount: 0, surfaceRankTieMismatchRate: 0,
      accentHueErrorDegrees: null, accentHueEligible: 0, accentHueLowChromaCandidates: 0,
      hardFailureCount: 0, textContrastFailures: 0, nonTextContrastFailures: 0,
      surfaceSeparationFailures: 0, surfaceRankReversals: 0, abstentions: 0},
    findings: [], manualSentinel: {status: 'not-run-in-m1-pair-evaluation', h3: null, h2: null, h1: null},
  };
}

function provenance(system: 'material' | 'primer', worktreeClean = true) {
  return {
    system, split: 'development' as const,
    evaluatorCommit: 'a'.repeat(40), worktreeClean,
    protocolId: `${system}-protocol`, protocolSha256: 'b'.repeat(64), m0ManifestSha256: '9'.repeat(64),
    sceneManifestSha256: 'c'.repeat(64), normalizedTokensSha256: 'd'.repeat(64),
    recordIdsSha256: 'e'.repeat(64), metricPayloadSha256: 'f'.repeat(64),
    baselineEngineCommit: '1'.repeat(40), roleProfilesSourceSha256: '2'.repeat(64),
    roleProfilesCanonicalSha256: '3'.repeat(64),
    source: {name: `${system}-source`, version: '1', integrity: 'sha512-test', license: 'MIT', repository: 'repo'},
    browser: {name: 'Google Chrome' as const, version: '150'}, nodeVersion: 'v26',
    viewport: {width: 1280, height: 900, deviceScaleFactor: 1}, locale: 'en-US', colorProfile: 'srgb' as const,
  };
}

function input(system: 'material' | 'primer', e: number, worktreeClean = true) {
  return {evaluation: evaluation(system, e), provenance: provenance(system, worktreeClean)};
}

describe('paired-theme report', () => {
  it('reports systems separately and uses only an equal-system descriptive macro', () => {
    const report = createPairedThemeReport([input('primer', 1), input('material', 0)]);
    expect(report.result.systems.map((system) => system.system)).toEqual(['material', 'primer']);
    expect(report.result.descriptiveSystemMacro).toMatchObject({gateEligible: false, e: 0.5, pairScore: 50});
    expect(report.result.systems[0]!.primary.relativeErrorReduction.value).toBeNull();
    expect(report.result.systems.map((system) => system.provenance.source.name))
      .toEqual(['material-source', 'primer-source']);
  });

  it('is deterministic and renders an accessible static evidence ledger', () => {
    const first = createPairedThemeReport([input('material', 0.25)]);
    const second = createPairedThemeReport([input('material', 0.25)]);
    expect(second).toEqual(first);
    const html = renderPairedThemeReportHtml(first);
    expect(html).toContain('<caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-label="Evidence chain"');
    expect(html).toContain('Not applicable (baseline only)');
    expect(html).toContain('PairScore</dt><dd>100 × (1 − E), reported /100 · higher is better');
    expect(html).toContain('Complete provenance · material');
    expect(html).toContain('Clean snapshot · non-gating baseline');
    expect(html).toContain('@media(max-width:520px)');
    expect(html).toContain('color-scheme:only light');
    expect(html).not.toContain('<script');
  });

  it('requires one matching provenance record per system', () => {
    expect(() => createPairedThemeReport([{
      evaluation: evaluation('material', 0.25),
      provenance: provenance('primer'),
    }])).toThrow(/does not match material/);
    expect(() => createPairedThemeReport([
      input('material', 0.25), input('material', 0.5),
    ])).toThrow(/Duplicate system/);
  });

  it('labels dirty development evidence and automatic hard-failure state', () => {
    const html = renderPairedThemeReportHtml(createPairedThemeReport([input('material', 0.25, false)]));
    expect(html).toContain('Dirty development run · non-gating');
    expect(html).toContain('F · automatic');
    expect(html).toContain('<strong>0</strong><em>Clear</em>');
    expect(html).toContain('H3/H2/H1 · manual');
  });

  it('prints strict finding boundaries without rounding equality', () => {
    const contrast = contrastFinding('material', 'form', 'focus', 'non-text', 2.9999998, 3);
    const separation = rankFinding('material', 'stack', 'raised',
      'surface-separation', 1.1199998, 1.12);
    expect(contrast.message).toContain('2.99999980 < 3.00000000');
    expect(separation.message).toContain('1.11999980 < 1.12000000');
    expect(`${contrast.message} ${separation.message}`).not.toContain('below');
  });

  it('refuses a false exact-reproduction claim', () => {
    expect(() => createPairedThemeReport([input('material', 0.25)], {
      status: 'exact', comparedResultSha256: '0'.repeat(64),
    })).toThrow(/does not match/);
  });
});
