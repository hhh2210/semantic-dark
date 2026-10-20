import {describe, expect, it} from 'vitest';

import type {AutomaticFinding} from '../../src/testing/paired-theme/evaluation-types';
import type {V2ArmEvaluation} from '../../src/testing/paired-theme/v2/evaluate-arm';
import type {FindingDelta, V2SystemComparison} from '../../src/testing/paired-theme/v2/evaluate';
import {
  createV2PairedThemeReport,
  renderV2PairedThemeReportHtml,
  serializeV2PairedThemeReportJson,
  type V2SystemReportProvenance,
} from '../../src/testing/paired-theme/v2/report';

const SHA = 'a'.repeat(64);

function finding(id: string, observed: number): AutomaticFinding {
  return {
    id, source: 'automatic', rule: 'surface-separation', severity: 'F',
    sceneId: 'surface-stack', targetId: 'surface.raised', observed, threshold: 1.12,
    comparison: 'baseline-open', vetoApplicable: false,
    message: `${observed.toFixed(8)} < 1.12000000`,
  };
}

function arm(
  system: string,
  primary: V2ArmEvaluation['primary'],
  findings: readonly AutomaticFinding[] = [],
): V2ArmEvaluation {
  return {
    schema: 'semantic-dark.paired-theme-arm-evaluation.v2',
    system, split: 'development', status: 'valid',
    counts: {
      scenes: 4, paintsPerVariant: 15, reviewedDecisions: 10,
      colorRows: 10, contrastRows: 6, rankPairs: 3,
      colorByRole: {text: 1}, contrastByRole: {text: 1},
    },
    rows: {color: [], contrast: [], rank: []}, primary,
    secondary: {
      contrastErrorRaw: primary.c, surfaceRankInversionRate: 0,
      surfaceRankTieMismatchCount: 0, surfaceRankTieMismatchRate: 0,
      accentHueErrorDegrees: null, accentHueEligible: 0,
      accentHueLowChromaCandidates: 0, hardFailureCount: findings.length,
      textContrastFailures: 0, nonTextContrastFailures: 0,
      surfaceSeparationFailures: findings.length, surfaceRankReversals: 0, abstentions: 0,
    },
    findings,
  };
}

function comparison(system: string, withDelta = false): V2SystemComparison {
  const baselinePrimary = {d: 0.6, c: 0.3, r: 0.1, e: 1 / 3, pairScore: 200 / 3};
  const candidatePrimary = {d: 0.5, c: 0.2, r: 0.1, e: 0.8 / 3, pairScore: 220 / 3};
  const baselineFinding = finding(`F/${system}/surface`, 1.11);
  const candidateFinding = finding(`F/${system}/surface`, 1.10);
  const findingDeltas: FindingDelta[] = withDelta ? [{
    id: baselineFinding.id, status: 'worsened',
    baseline: baselineFinding, candidate: candidateFinding,
  }] : [];
  return {
    schema: 'semantic-dark.paired-theme-system-comparison.v2', metricSpecSha256: SHA,
    protocolSha256: 'b'.repeat(64), sceneManifestSha256: 'c'.repeat(64),
    system, split: 'development', replicateIds: [`${system}-run-1`, `${system}-run-2`],
    counts: {
      scenes: 4, paintsPerVariant: 15, variants: 4, replicates: 2,
      rawObservationsPerReplicate: 60, rawObservationsAcrossReplicates: 120,
      perArm: {reviewed: 10, color: 10, contrast: 6, rank: 3},
      comparison: {color: 20, contrast: 12, rank: 6},
    },
    baseline: arm(system, baselinePrimary, withDelta ? [baselineFinding] : []),
    candidate: arm(system, candidatePrimary, withDelta ? [candidateFinding] : []),
    comparison: {
      relativeImprovement: {
        formula: '(E_baseline-E_candidate)/E_baseline',
        baselineE: baselinePrimary.e, candidateE: candidatePrimary.e,
        value: 0.2, status: 'valid',
      },
      componentNonRegression: {d: true, c: true, r: true},
      findingDeltas, newOrWorsenedF: findingDeltas.length,
    },
  };
}

function provenance(
  system: string,
  extra: Readonly<Record<string, unknown>> = {},
): V2SystemReportProvenance {
  return {
    system, metricSpecSha256: SHA,
    protocolId: `${system}<script>alert(1)</script>`, protocolSha256: 'b'.repeat(64),
    sceneManifestSha256: 'c'.repeat(64), observationSha256: 'd'.repeat(64),
    engineCommit: '1'.repeat(40), evaluatorCommit: '2'.repeat(40),
    profiles: {
      baseline: {semanticSha256: 'e'.repeat(64), fileSha256: 'f'.repeat(64)},
      candidate: {semanticSha256: '3'.repeat(64), fileSha256: '4'.repeat(64)},
    },
    ...extra,
  };
}

describe('paired-theme v2 report', () => {
  it('preserves frozen system order and exposes only a descriptive equal-system macro', () => {
    const report = createV2PairedThemeReport([
      {comparison: comparison('zeta'), provenance: provenance('zeta')},
      {comparison: comparison('alpha'), provenance: provenance('alpha')},
    ]);
    expect(report.result.systemOrder).toEqual(['zeta', 'alpha']);
    expect(report.result.systems.map((item) => item.system)).toEqual(['zeta', 'alpha']);
    expect(report.result.descriptiveSystemMacro).toMatchObject({
      gateEligible: false, scope: 'descriptive-only-never-gate', systemCount: 2,
      baseline: {d: 0.6, c: 0.3, r: 0.1, e: 1 / 3, pairScore: 200 / 3},
      candidate: {d: 0.5, c: 0.2, r: 0.1, e: 0.8 / 3, pairScore: 220 / 3},
    });
    expect(report.result.descriptiveSystemMacro).not.toHaveProperty('relativeImprovement');
  });

  it('returns canonical deterministic JSON independent of provenance key insertion order', () => {
    const left = createV2PairedThemeReport([{comparison: comparison('material'),
      provenance: provenance('material', {extra: {z: 1, a: 2}})}]);
    const right = createV2PairedThemeReport([{comparison: comparison('material'),
      provenance: provenance('material', {extra: {a: 2, z: 1}})}]);
    expect(right).toEqual(left);
    expect(serializeV2PairedThemeReportJson(right)).toBe(
      serializeV2PairedThemeReportJson(left),
    );
    expect(JSON.parse(serializeV2PairedThemeReportJson(left))).toEqual(left);
  });

  it('renders both arms, all gates, F deltas, and exact frozen denominators', () => {
    const report = createV2PairedThemeReport([{comparison: comparison('material', true),
      provenance: provenance('material')}]);
    const first = renderV2PairedThemeReportHtml(report);
    const second = renderV2PairedThemeReportHtml(report);
    expect(second).toBe(first);
    expect(first).toMatch(/^<!doctype html>/);
    expect(first).toContain('Baseline');
    expect(first).toContain('M2 candidate');
    expect(first).toContain('<th scope="col">D NR</th>');
    expect(first).toContain('<td class="pass">Pass</td>');
    expect(first).toContain('20.0000%');
    expect(first).toContain('60 / replicate · 120 / 2 replicates');
    expect(first).toContain('10/6/3 · reviewed 10');
    expect(first).toContain('20/12/6');
    expect(first).toContain('worsened');
    expect(first).toContain('baseline 1.1100 / threshold 1.1200');
    expect(first).toContain('candidate 1.1000 / threshold 1.1200');
    expect(first).toContain('Descriptive only · never a gate.');
    expect(first).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(first).not.toContain('<script');
    expect(report.result.systems[0]!.provenance).toMatchObject({
      engineCommit: '1'.repeat(40), evaluatorCommit: '2'.repeat(40),
    });
  });

  it('rejects mixed identity, duplicate systems, and inconsistent denominators', () => {
    const value = comparison('material');
    expect(() => createV2PairedThemeReport([{comparison: value,
      provenance: provenance('primer')}])).toThrow(/does not match material/);
    expect(() => createV2PairedThemeReport([{comparison: value,
      provenance: provenance('material', {protocolSha256: '5'.repeat(64)})}]))
      .toThrow(/protocol does not match material/);
    expect(() => createV2PairedThemeReport([{comparison: value,
      provenance: provenance('material', {sceneManifestSha256: '6'.repeat(64)})}]))
      .toThrow(/scene manifest does not match material/);
    expect(() => createV2PairedThemeReport([
      {comparison: value, provenance: provenance('material')},
      {comparison: value, provenance: provenance('material')},
    ])).toThrow(/Duplicate v2 system/);

    const badCounts = structuredClone(value);
    badCounts.counts.rawObservationsAcrossReplicates = 119;
    expect(() => createV2PairedThemeReport([{comparison: badCounts,
      provenance: provenance('material')}])).toThrow(/denominator mismatch/);

    const badArm = structuredClone(value);
    badArm.candidate.system = 'other';
    expect(() => createV2PairedThemeReport([{comparison: badArm,
      provenance: provenance('material')}])).toThrow(/arm identity mismatch/);
  });
});
