import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {serializeJson, sha256Text} from '../../src/testing/artifacts';
import {
  createHeldOutExposureReceipt,
  evaluateM2Gate,
  FROZEN_IMPLEMENTATION_PATHS,
  metricConfigFromFrozenSpec,
  validateFrozenMetricSpec,
  verifyFrozenMetricSpecFiles,
  withHeldOutExposureReceipt,
} from '../../src/testing/paired-theme/metric-freeze';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((item) => rm(item, {
  recursive: true, force: true,
}))));

describe('paired-theme metric freeze contract', () => {
  it('accepts only the preregistered formulas, constants, inventories, and cells', () => {
    const spec = makeSpec();
    expect(validateFrozenMetricSpec(spec)).toBe(spec);
    expect(metricConfigFromFrozenSpec(spec)).toEqual({
      status: 'frozen-v1', deltaEOkCap: 0.1, contrastLog2Cap: 1,
      rankTieEpsilon: 0.01, comparisonEpsilon: 1e-7, accentChromaThreshold: 0.02,
      textContrastFloor: 4.5, nonTextContrastFloor: 3, surfaceSeparationFloor: 1.12,
      componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
    });

    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => { copy.surprise = true; })))
      .toThrow(/unknown or missing keys/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.primary.color.formula = 'chosen-after-results';
    }))).toThrow(/primary\.color\.formula/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.primary.composite.weights.color = 2;
    }))).toThrow(/weights\.color/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.safety.comparisonEpsilon = 0.01;
    }))).toThrow(/comparisonEpsilon/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.sources[0].package.extra = 'not allowed';
    }))).toThrow(/unknown or missing keys/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.reviewed[0].paintId = 'outcome-selected';
    }))).toThrow(/reviewed\[0\]\.paintId/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.reviewed.pop();
    }))).toThrow(/exactly 10/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.contrast.push(copy.records.contrast[0]);
    }))).toThrow(/exactly 6/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.rank[1] = copy.records.rank[0];
    }))).toThrow(/rank\[1\]/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.systems.reverse();
    }))).toThrow(/records\.systems/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.aggregationCells.colorRoleScene.pop();
    }))).toThrow(/colorRoleScene/);
    expect(() => validateFrozenMetricSpec(withMutation(spec, (copy) => {
      copy.records.totals.totalContrastRows = 29;
    }))).toThrow(/totalContrastRows/);
  });

  it('verifies the M0, scene, role-profile, and implementation content pins', async () => {
    const root = await temporaryDirectory('metric-pins-');
    const spec = makeSpec();
    const roleText = 'export const ROLE_PROFILES = {}\n';
    const sceneText = '{"schema":"semantic-dark.paired-theme-scenes.v1"}\n';
    await write(root, 'src/color/dark-map.ts', roleText);
    await write(root, spec.records.sceneManifest, sceneText);
    spec.baseline.roleProfilesSourceSha256 = sha256Text(roleText);
    spec.records.sceneManifestSha256 = sha256Text(sceneText);
    const m0 = {
      schema: 'semantic-dark.m0-manifest.v1',
      baseline: {commit: spec.baseline.engineCommit},
      role_profiles: {
        source: spec.baseline.roleProfilesSource,
        source_sha256: spec.baseline.roleProfilesSourceSha256,
        canonical_sha256: spec.baseline.roleProfilesCanonicalSha256,
      },
    };
    const m0Text = serializeJson(m0);
    await write(root, spec.baseline.m0Manifest, m0Text);
    spec.baseline.m0ManifestSha256 = sha256Text(m0Text);
    for (const [index, filePath] of FROZEN_IMPLEMENTATION_PATHS.entries()) {
      const content = filePath === spec.baseline.roleProfilesSource
        ? roleText
        : `pin-${index}\n`;
      if (filePath !== spec.baseline.roleProfilesSource) await write(root, filePath, content);
      spec.implementationPins.files[index] = {path: filePath, sha256: sha256Text(content)};
    }

    await expect(verifyFrozenMetricSpecFiles(spec, root)).resolves.toEqual({
      m0ManifestSha256: spec.baseline.m0ManifestSha256,
      sceneManifestSha256: spec.records.sceneManifestSha256,
      roleProfilesSourceSha256: spec.baseline.roleProfilesSourceSha256,
      implementationFiles: FROZEN_IMPLEMENTATION_PATHS.length,
    });
    await writeFile(path.join(root, FROZEN_IMPLEMENTATION_PATHS[4]!), 'tampered\n');
    await expect(verifyFrozenMetricSpecFiles(spec, root)).rejects.toThrow(/SHA-256 mismatch/);
  });
});

describe('M2 preregistered gate', () => {
  const passing = (system: 'carbon' | 'fluent') => ({
    system,
    baseline: {d: 0.3, c: 0.3, r: 0.3, e: 0.3},
    candidate: {d: 0.24, c: 0.24, r: 0.24, e: 0.24},
    newOrWorsenedFailures: {f: 0, h2: 0, h3: 0},
  });

  it('requires the relative threshold and every condition independently per system', () => {
    const result = evaluateM2Gate(makeSpec(), [passing('fluent'), passing('carbon')]);
    expect(result.passed).toBe(true);
    expect(result.systems.map((item) => item.system)).toEqual(['carbon', 'fluent']);
    expect(result.systems[0]!.relativeImprovement).toBeCloseTo(0.2, 12);

    const componentRegression = passing('carbon');
    componentRegression.candidate = {d: 0, c: 0.31, r: 0, e: 0.31 / 3};
    const failure = passing('fluent'); failure.newOrWorsenedFailures.h2 = 1;
    const failed = evaluateM2Gate(makeSpec(), [componentRegression, failure]);
    expect(failed.passed).toBe(false);
    expect(failed.systems[0]!.conditions.contrastNonRegression).toBe(false);
    expect(failed.systems[1]!.conditions.zeroH2).toBe(false);

    const boundary = passing('carbon');
    boundary.candidate = {d: 0.27, c: 0.27, r: 0.27, e: 0.27};
    expect(evaluateM2Gate(makeSpec(), [boundary, passing('fluent')]).passed).toBe(true);

    for (const key of ['f', 'h2', 'h3'] as const) {
      const regression = passing('carbon'); regression.newOrWorsenedFailures[key] = 1;
      expect(evaluateM2Gate(makeSpec(), [regression, passing('fluent')]).passed).toBe(false);
    }
  });

  it('fails an E_baseline=0 relative gate and rejects an incomplete held-out pair', () => {
    const zero = passing('carbon');
    zero.baseline = {d: 0, c: 0, r: 0, e: 0};
    zero.candidate = {d: 0, c: 0, r: 0, e: 0};
    const result = evaluateM2Gate(makeSpec(), [zero, passing('fluent')]);
    expect(result.systems[0]).toMatchObject({
      passed: false, relativeImprovement: null,
      conditions: {baselineNonZero: false, minimumImprovement: false},
    });
    expect(() => evaluateM2Gate(makeSpec(), [passing('carbon'), passing('carbon')]))
      .toThrow(/one result each/);
  });
});

describe('held-out exposure receipt', () => {
  it('uses an exclusive claim and preserves it when the exposed action fails', async () => {
    const directory = await temporaryDirectory('metric-exposure-');
    const digest = 'd'.repeat(64); const commit = 'c'.repeat(40);
    await expect(withHeldOutExposureReceipt(
      makeSpec(), digest, commit, async (claim) => {
        expect(JSON.parse(await readFile(claim.path, 'utf8'))).toMatchObject({
          metricSpecSha256: digest, systems: ['carbon', 'fluent'],
          status: 'claimed-consumes-exposure', failureConsumesExposure: true,
        });
        throw new Error('adapter failed after exposure claim');
      },
      {directory, now: () => new Date('2026-07-19T00:00:00.000Z'), pid: 7},
    )).rejects.toThrow(/adapter failed/);
    await expect(readFile(path.join(directory, `${digest}.json`), 'utf8')).resolves.toContain(
      'claimed-consumes-exposure',
    );
    await expect(createHeldOutExposureReceipt(makeSpec(), digest, commit, {directory}))
      .rejects.toMatchObject({code: 'EEXIST'});
  });
});

function makeSpec(): any {
  const sha = 'a'.repeat(64);
  const reviewed = [
    ['surface-stack', 'surface.canvas', 'background', 'canvas'],
    ['surface-stack', 'surface.raised', 'surface', 'surfaceRaised'],
    ['surface-stack', 'surface.title', 'text', 'textPrimary'],
    ['table-selection', 'table.header', 'surface', 'tableHeader'],
    ['table-selection', 'table.selected', 'accent', 'selectedSurface'],
    ['table-selection', 'table.text', 'text', 'textPrimary'],
    ['form-focus', 'form.border', 'border', 'border'], ['form-focus', 'form.focus', 'accent', 'focus'],
    ['status-alert', 'status.surface', 'surface', 'dangerSurface'],
    ['status-alert', 'status.text', 'text', 'dangerText'],
  ].map(([sceneId, paintId, role, token]) => ({sceneId, paintId, role, token}));
  const contrast = [
    ['surface-stack', 'surface.title', 'text', 'text', 'surface.raised'],
    ['table-selection', 'table.selected', 'accent', 'non-text', 'table.canvas'],
    ['table-selection', 'table.text', 'text', 'text', 'table.header'],
    ['form-focus', 'form.border', 'border', 'non-text', 'form.surface'],
    ['form-focus', 'form.focus', 'accent', 'non-text', 'form.surface'],
    ['status-alert', 'status.text', 'text', 'text', 'status.surface'],
  ].map(([sceneId, paintId, role, kind, backdropPaintId]) => ({sceneId, paintId, role, kind, backdropPaintId}));
  const rank = [
    ['surface-stack', 'surface.card-to-raised', 'surface.card', 'surface.raised'],
    ['table-selection', 'table.canvas-to-header', 'table.canvas', 'table.header'],
    ['status-alert', 'status.canvas-to-surface', 'status.canvas', 'status.surface'],
  ].map(([sceneId, pairId, lowerPaintId, upperPaintId]) => ({sceneId, pairId, lowerPaintId, upperPaintId}));
  const packages = [
    ['material', 'reference', 'fixtures/paired-theme/material-v1.protocol.json', '@material/material-color-utilities', '0.4.0', 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==', 'Apache-2.0', 'https://github.com/material-foundation/material-color-utilities', 'generated-scheme'],
    ['primer', 'reference', 'fixtures/paired-theme/primer-v1.protocol.json', '@primer/primitives', '11.9.0', 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==', 'MIT', 'https://github.com/primer/primitives', 'precommitted-semantic-token-names'],
    ['spectrum', 'reference', 'fixtures/paired-theme/spectrum-v1.protocol.json', '@adobe/spectrum-design-data', '0.12.0', 'sha512-R1Nso0lDPrev//uBuxWlTsCZ1aJtlNxnF0rTnEYr9ykgzeMI9sw9nWakmqWFcy+KzF39kncDxkIOG6en/UyWQA==', 'Apache-2.0', 'https://github.com/adobe/spectrum-design-data', 'precommitted-uuid-roots'],
    ['carbon', 'held-out', 'fixtures/paired-theme/carbon-v1.protocol.json', '@carbon/themes', '11.77.0', 'sha512-5MGfcWiKwpIAmmtq4zlAeSkGkECaVXhr61Ol0EUFQskUlhAgeKhlIc5iWXFmwDb25oxzEFo0puH+GKsLL4GN/w==', 'Apache-2.0', 'https://github.com/carbon-design-system/carbon', 'precommitted-semantic-token-names'],
    ['fluent', 'held-out', 'fixtures/paired-theme/fluent-v1.protocol.json', '@fluentui/react-theme', '9.2.1', 'sha512-lJxfz7LmmglFz+c9C41qmMqaRRZZUPtPPl9DWQ79vH+JwZd4dkN7eA78OTRwcGCOTPEKoLTX72R+EFaWEDlX+w==', 'MIT', 'https://github.com/microsoft/fluentui', 'precommitted-semantic-token-names'],
  ];
  return {
    $schema: './metric-spec.schema.json', schema: 'semantic-dark.paired-theme-metric-spec.v1',
    id: 'semantic-dark.paired-theme-metric.v1', version: 1, status: 'frozen',
    baseline: {m0Manifest: 'fixtures/evaluation/m0-manifest.v1.json', m0ManifestSha256: sha,
      engineCommit: 'b'.repeat(40), roleProfilesSource: 'src/color/dark-map.ts',
      roleProfilesSourceSha256: sha, roleProfilesCanonicalSha256: sha},
    sources: packages.map(([system, split, protocol, name, version, integrity, license,
      repository, mappingPolicy]) => ({system, split, protocol,
      package: {name, version, integrity, license, repository}, mappingPolicy})),
    records: {sceneManifest: 'fixtures/paired-theme/common-scenes.v1.json', sceneManifestSha256: sha,
      systems: ['material', 'primer', 'spectrum', 'carbon', 'fluent'], identity: 'system/sceneId/paintId',
      reviewed, contrast, rank, aggregationCells: {
        colorRoleScene: ['background/surface-stack', 'surface/surface-stack', 'text/surface-stack',
          'surface/table-selection', 'accent/table-selection', 'text/table-selection',
          'border/form-focus', 'accent/form-focus', 'surface/status-alert', 'text/status-alert'],
        contrastRoleScene: ['text/surface-stack', 'accent/table-selection', 'text/table-selection',
          'border/form-focus', 'accent/form-focus', 'text/status-alert'],
        rankScenes: ['surface-stack', 'table-selection', 'status-alert'],
        emptyCellPolicy: 'a-preregistered-empty-cell-invalidates-the-run'},
      totals: {systems: 5, scenesPerSystem: 4, paintsPerVariant: 15, observationsPerSystem: 45,
        reviewedPerSystem: 10, totalReviewedRows: 50, colorRowsPerSystem: 10, totalColorRows: 50,
        contrastRowsPerSystem: 6, totalContrastRows: 30, rankRowsPerSystem: 3, totalRankRows: 15},
      missingPolicy: 'invalidate-run', extraPolicy: 'invalidate-run', duplicatePolicy: 'invalidate-run',
      abstentionPolicy: 'score-unchanged-light-paint; extraction-failure-is-not-abstention'},
    colorPipeline: {space: 'computed-srgb', source: 'fresh-headless-chrome-computed-style',
      alpha: 'gamma-encoded-srgb-source-over-recorded-backdrop-until-opaque',
      contrast: 'WCAG-relative-luminance-after-effective-paint-compositing'},
    primary: {color: {formula: 'd_i=min(Euclidean_OKLab(candidate_i,authored_dark_i)/0.10,1)', cap: 0.1},
      contrast: {formula: 'c_i=min(abs(log2(candidate_contrast_i/authored_contrast_i)),1)', cap: 1},
      rank: {formula: 'r_i=abs(relation(candidate_deltaL)-relation(authored_deltaL))/2', tieEpsilon: 0.01},
      aggregation: {color: 'decision-median->scene-mean->role-mean', contrast: 'applicable-decision-median->scene-mean->role-mean', rank: 'pair-mean->scene-mean', system: 'independent-no-pooling'},
      composite: {weights: {color: 1, contrast: 1, rank: 1, denominator: 3}, error: 'E_s=(D_s+C_s+R_s)/3', score: 'PairScore_s=100*(1-E_s)', relativeImprovement: 'I_s=(E_baseline_s-E_candidate_s)/E_baseline_s'}},
    secondary: {rawContrastError: 'same-frozen-cells-uncapped-absolute-log2-error', rankInversionRate: 'fraction-of-frozen-pairs-with-loss-1', tieMismatchRate: 'fraction-of-frozen-pairs-with-loss-0.5', accentHueError: 'median-circular-degrees-over-eligible-authored-accent-rows', accentChromaThreshold: 0.02, lowChromaCandidatePenaltyDegrees: 180},
    safety: {comparisonEpsilon: 1e-7, textContrastFloor: 4.5, nonTextContrastFloor: 3,
      surfaceSeparationFloor: 1.12, hardFailureIds: ['text-contrast', 'non-text-contrast', 'surface-separation', 'surface-rank-reversal', 'native-dark', 'restore', 'extraction'],
      operationalDefinitions: {textContrast: 'candidate_ratio+1e-7<4.5', nonTextContrast: 'candidate_ratio+1e-7<3.0', surfaceSeparation: 'candidate_ratio+1e-7<1.12', surfaceRankReversal: 'authored_relation_is_non-tie-and-candidate_relation_is-opposite', nativeDark: 'automatic-mode-adds-any-extension-owned-root-or-paint-mutation', restore: 'any-owned-attribute-variable-svg-resource-url-or-computed-paint-diff-remains', extraction: 'missing-extra-duplicate-or-unresolved-record-invalidates-the-run'},
      severityDefinitions: {F: 'independent-automatic-invariant-failure', H3: 'content-or-control-unusable-meaning-changed-or-protected-media-destructively-recolored', H2: 'main-task-possible-but-primary-hierarchy-state-diagram-or-large-region-requires-disable', H1: 'local-aesthetic-hue-or-chroma-regression-without-meaning-readability-or-interaction-loss', H0: 'equivalent-to-or-better-than-baseline'},
      reviewPolicy: 'page-is-one-clustered-case-worst-state-wins-and-suspected-F/H2/H3-get-second-review',
      severityOrder: 'H0<H1<H2<H3; F-is-an-independent-invariant-failure', candidateRegression: 'new-failure-or-worse-margin-or-higher-page-severity-or-expanded-H2/H3-scope'},
    m2Gate: {minimumRelativeImprovementPerSystem: 0.1, componentNonRegressionTolerance: 1e-12,
      requiredSystems: ['carbon', 'fluent'], baselineZeroPolicy: 'relative-gate-not-evaluable-and-fails', requiredConditions: 'I>=0.10-and-no-D/C/R-regression-and-no-new-or-worsened-F/H2/H3-per-system', macroEligible: false},
    reportContract: {perSystemRequired: true, systemMacro: 'descriptive-only', rowMicroAverage: 'forbidden-for-selection', manualSentinelLanguage: 'no-veto-observed-not-statistical-significance'},
    implementationPins: {files: FROZEN_IMPLEMENTATION_PATHS.map((filePath) => ({path: filePath, sha256: sha}))},
    heldOutAccessPolicy: {systems: ['carbon', 'fluent'], logicalEvaluations: 1,
      replicatesPerLogicalEvaluation: 2, combinedOnly: true, freezeCommitAtRuntime: true,
      receipt: '~/scratch-data/semantic-dark-pairs/.exposure/{metricSpecSha256}.json',
      failureConsumesExposure: true, adapterLoadAfterReceipt: true, sourceValueReadAfterReceipt: true,
      packageMaterialization: 'pre-freeze-pnpm-policy-preflight-no-token-import-or-read',
      postM1Status: 'carbon-and-fluent-spent-not-valid-confirmatory-holdouts-for-M2'},
  };
}

function withMutation(value: any, mutate: (copy: any) => void): any {
  const copy = structuredClone(value); mutate(copy); return copy;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix)); temporaryDirectories.push(directory);
  return directory;
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const destination = path.join(root, relative); await mkdir(path.dirname(destination), {recursive: true});
  await writeFile(destination, content, 'utf8');
}
