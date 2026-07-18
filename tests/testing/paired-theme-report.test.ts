import {describe, expect, it} from 'vitest';

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

const provenance = {
  evaluatorCommit: 'a'.repeat(40), worktreeClean: true,
  protocolId: 'protocol', protocolSha256: 'b'.repeat(64), m0ManifestSha256: '9'.repeat(64),
  sceneManifestSha256: 'c'.repeat(64), normalizedTokensSha256: 'd'.repeat(64),
  recordIdsSha256: 'e'.repeat(64), metricPayloadSha256: 'f'.repeat(64),
  baselineEngineCommit: '1'.repeat(40), roleProfilesSourceSha256: '2'.repeat(64),
  roleProfilesCanonicalSha256: '3'.repeat(64),
  source: {name: 'source', version: '1', integrity: 'sha512-test', license: 'MIT', repository: 'repo'},
  browser: {name: 'Google Chrome' as const, version: '150'}, nodeVersion: 'v26',
  viewport: {width: 1280, height: 900, deviceScaleFactor: 1}, locale: 'en-US', colorProfile: 'srgb' as const,
};

describe('paired-theme report', () => {
  it('reports systems separately and uses only an equal-system descriptive macro', () => {
    const report = createPairedThemeReport([evaluation('primer', 1), evaluation('material', 0)], provenance);
    expect(report.result.systems.map((system) => system.system)).toEqual(['material', 'primer']);
    expect(report.result.descriptiveSystemMacro).toMatchObject({gateEligible: false, e: 0.5, pairScore: 50});
    expect(report.result.systems[0]!.primary.relativeErrorReduction.value).toBeNull();
  });

  it('is deterministic and renders an accessible static evidence ledger', () => {
    const first = createPairedThemeReport([evaluation('material', 0.25)], provenance);
    const second = createPairedThemeReport([evaluation('material', 0.25)], {...provenance});
    expect(second).toEqual(first);
    const html = renderPairedThemeReportHtml(first);
    expect(html).toContain('<caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-label="Evidence chain"');
    expect(html).toContain('Not applicable (baseline only)');
    expect(html).not.toContain('<script');
  });

  it('refuses a false exact-reproduction claim', () => {
    expect(() => createPairedThemeReport([evaluation('material', 0.25)], provenance, {
      status: 'exact', comparedResultSha256: '0'.repeat(64),
    })).toThrow(/does not match/);
  });
});
