import type {PairedThemeSystem} from './types';

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export const FROZEN_SYSTEMS = [
  'material', 'primer', 'spectrum', 'carbon', 'fluent',
] as const satisfies readonly PairedThemeSystem[];

const SOURCE_CONTRACT = [
  ['material', 'reference', 'fixtures/paired-theme/material-v1.protocol.json', '@material/material-color-utilities', '0.4.0', 'sha512-dlq6VExJReb8dhjj3a/yTigr3ncNwoFmL5Iy2ENtbDX03EmNeOEdZ+vsaGrj7RTuO+mB7L58II4LCsl4NpM8uw==', 'Apache-2.0', 'https://github.com/material-foundation/material-color-utilities', 'generated-scheme'],
  ['primer', 'reference', 'fixtures/paired-theme/primer-v1.protocol.json', '@primer/primitives', '11.9.0', 'sha512-yESOalhd7s7S3unV1V32v3Z0RszXiiz6pzy6hVI9xpdTh1q1Gt8vyDFxRlqIvuwc5ZaO1+gYQTDbjxb4nWBzMw==', 'MIT', 'https://github.com/primer/primitives', 'precommitted-semantic-token-names'],
  ['spectrum', 'reference', 'fixtures/paired-theme/spectrum-v1.protocol.json', '@adobe/spectrum-design-data', '0.12.0', 'sha512-R1Nso0lDPrev//uBuxWlTsCZ1aJtlNxnF0rTnEYr9ykgzeMI9sw9nWakmqWFcy+KzF39kncDxkIOG6en/UyWQA==', 'Apache-2.0', 'https://github.com/adobe/spectrum-design-data', 'precommitted-uuid-roots'],
  ['carbon', 'held-out', 'fixtures/paired-theme/carbon-v1.protocol.json', '@carbon/themes', '11.77.0', 'sha512-5MGfcWiKwpIAmmtq4zlAeSkGkECaVXhr61Ol0EUFQskUlhAgeKhlIc5iWXFmwDb25oxzEFo0puH+GKsLL4GN/w==', 'Apache-2.0', 'https://github.com/carbon-design-system/carbon', 'precommitted-semantic-token-names'],
  ['fluent', 'held-out', 'fixtures/paired-theme/fluent-v1.protocol.json', '@fluentui/react-theme', '9.2.1', 'sha512-lJxfz7LmmglFz+c9C41qmMqaRRZZUPtPPl9DWQ79vH+JwZd4dkN7eA78OTRwcGCOTPEKoLTX72R+EFaWEDlX+w==', 'MIT', 'https://github.com/microsoft/fluentui', 'precommitted-semantic-token-names'],
] as const;

export const FROZEN_IMPLEMENTATION_PATHS = [
  'src/color/composite.ts', 'src/color/contrast.ts', 'src/color/css.ts',
  'src/color/dark-map.ts', 'src/color/index.ts', 'src/color/oklab.ts',
  'src/color/srgb.ts', 'src/color/types.ts',
  'src/testing/paired-theme/candidate.ts', 'src/testing/paired-theme/cli.ts',
  'src/testing/paired-theme/collector.ts',
  'src/testing/paired-theme/evaluate.ts', 'src/testing/paired-theme/evaluation-support.ts',
  'src/testing/paired-theme/heldout-cli.ts', 'src/testing/paired-theme/heldout-runner.ts',
  'src/testing/paired-theme/heldout-source.ts', 'src/testing/paired-theme/material.ts',
  'src/testing/paired-theme/metric-freeze-validation.ts', 'src/testing/paired-theme/metric-freeze.ts',
  'src/testing/paired-theme/metric-reducers.ts', 'src/testing/paired-theme/metrics.ts',
  'src/testing/paired-theme/observations.ts', 'src/testing/paired-theme/primer.ts',
  'src/testing/paired-theme/protocol-source.ts', 'src/testing/paired-theme/protocol.ts',
  'src/testing/paired-theme/render.ts', 'src/testing/paired-theme/report.ts',
  'src/testing/paired-theme/runner.ts', 'src/testing/paired-theme/source.ts',
  'src/testing/paired-theme/spectrum-resolver.ts', 'src/testing/paired-theme/spectrum.ts',
  'src/testing/paired-theme/types.ts', 'src/testing/paired-theme/variants.ts',
] as const;

const REVIEWED = [
  ['surface-stack', 'surface.canvas', 'background', 'canvas'],
  ['surface-stack', 'surface.raised', 'surface', 'surfaceRaised'],
  ['surface-stack', 'surface.title', 'text', 'textPrimary'],
  ['table-selection', 'table.header', 'surface', 'tableHeader'],
  ['table-selection', 'table.selected', 'accent', 'selectedSurface'],
  ['table-selection', 'table.text', 'text', 'textPrimary'],
  ['form-focus', 'form.border', 'border', 'border'],
  ['form-focus', 'form.focus', 'accent', 'focus'],
  ['status-alert', 'status.surface', 'surface', 'dangerSurface'],
  ['status-alert', 'status.text', 'text', 'dangerText'],
] as const;

const CONTRAST = [
  ['surface-stack', 'surface.title', 'text', 'text', 'surface.raised'],
  ['table-selection', 'table.selected', 'accent', 'non-text', 'table.canvas'],
  ['table-selection', 'table.text', 'text', 'text', 'table.header'],
  ['form-focus', 'form.border', 'border', 'non-text', 'form.surface'],
  ['form-focus', 'form.focus', 'accent', 'non-text', 'form.surface'],
  ['status-alert', 'status.text', 'text', 'text', 'status.surface'],
] as const;

const RANK = [
  ['surface-stack', 'surface.card-to-raised', 'surface.card', 'surface.raised'],
  ['table-selection', 'table.canvas-to-header', 'table.canvas', 'table.header'],
  ['status-alert', 'status.canvas-to-surface', 'status.canvas', 'status.surface'],
] as const;

const FIXED = {
  colorPipeline: {
    space: 'computed-srgb', source: 'fresh-headless-chrome-computed-style',
    alpha: 'gamma-encoded-srgb-source-over-recorded-backdrop-until-opaque',
    contrast: 'WCAG-relative-luminance-after-effective-paint-compositing',
  },
  primary: {
    color: {formula: 'd_i=min(Euclidean_OKLab(candidate_i,authored_dark_i)/0.10,1)', cap: 0.1},
    contrast: {formula: 'c_i=min(abs(log2(candidate_contrast_i/authored_contrast_i)),1)', cap: 1},
    rank: {formula: 'r_i=abs(relation(candidate_deltaL)-relation(authored_deltaL))/2', tieEpsilon: 0.01},
    aggregation: {
      color: 'decision-median->scene-mean->role-mean',
      contrast: 'applicable-decision-median->scene-mean->role-mean',
      rank: 'pair-mean->scene-mean', system: 'independent-no-pooling',
    },
    composite: {
      weights: {color: 1, contrast: 1, rank: 1, denominator: 3},
      error: 'E_s=(D_s+C_s+R_s)/3', score: 'PairScore_s=100*(1-E_s)',
      relativeImprovement: 'I_s=(E_baseline_s-E_candidate_s)/E_baseline_s',
    },
  },
  secondary: {
    rawContrastError: 'same-frozen-cells-uncapped-absolute-log2-error',
    rankInversionRate: 'fraction-of-frozen-pairs-with-loss-1',
    tieMismatchRate: 'fraction-of-frozen-pairs-with-loss-0.5',
    accentHueError: 'median-circular-degrees-over-eligible-authored-accent-rows',
    accentChromaThreshold: 0.02, lowChromaCandidatePenaltyDegrees: 180,
  },
  safety: {
    comparisonEpsilon: 1e-7, textContrastFloor: 4.5, nonTextContrastFloor: 3,
    surfaceSeparationFloor: 1.12,
    hardFailureIds: ['text-contrast', 'non-text-contrast', 'surface-separation',
      'surface-rank-reversal', 'native-dark', 'restore', 'extraction'],
    operationalDefinitions: {
      textContrast: 'candidate_ratio+1e-7<4.5',
      nonTextContrast: 'candidate_ratio+1e-7<3.0',
      surfaceSeparation: 'candidate_ratio+1e-7<1.12',
      surfaceRankReversal: 'authored_relation_is_non-tie-and-candidate_relation_is-opposite',
      nativeDark: 'automatic-mode-adds-any-extension-owned-root-or-paint-mutation',
      restore: 'any-owned-attribute-variable-svg-resource-url-or-computed-paint-diff-remains',
      extraction: 'missing-extra-duplicate-or-unresolved-record-invalidates-the-run',
    },
    severityDefinitions: {
      F: 'independent-automatic-invariant-failure',
      H3: 'content-or-control-unusable-meaning-changed-or-protected-media-destructively-recolored',
      H2: 'main-task-possible-but-primary-hierarchy-state-diagram-or-large-region-requires-disable',
      H1: 'local-aesthetic-hue-or-chroma-regression-without-meaning-readability-or-interaction-loss',
      H0: 'equivalent-to-or-better-than-baseline',
    },
    reviewPolicy: 'page-is-one-clustered-case-worst-state-wins-and-suspected-F/H2/H3-get-second-review',
    severityOrder: 'H0<H1<H2<H3; F-is-an-independent-invariant-failure',
    candidateRegression: 'new-failure-or-worse-margin-or-higher-page-severity-or-expanded-H2/H3-scope',
  },
  m2Gate: {
    minimumRelativeImprovementPerSystem: 0.1, componentNonRegressionTolerance: 1e-12,
    requiredSystems: ['carbon', 'fluent'], baselineZeroPolicy: 'relative-gate-not-evaluable-and-fails',
    requiredConditions: 'I>=0.10-and-no-D/C/R-regression-and-no-new-or-worsened-F/H2/H3-per-system',
    macroEligible: false,
  },
  reportContract: {
    perSystemRequired: true, systemMacro: 'descriptive-only',
    rowMicroAverage: 'forbidden-for-selection',
    manualSentinelLanguage: 'no-veto-observed-not-statistical-significance',
  },
  heldOutAccessPolicy: {
    systems: ['carbon', 'fluent'], logicalEvaluations: 1, replicatesPerLogicalEvaluation: 2,
    combinedOnly: true, freezeCommitAtRuntime: true,
    receipt: '~/scratch-data/semantic-dark-pairs/.exposure/{metricSpecSha256}.json',
    failureConsumesExposure: true, adapterLoadAfterReceipt: true, sourceValueReadAfterReceipt: true,
    packageMaterialization: 'pre-freeze-pnpm-policy-preflight-no-token-import-or-read',
    postM1Status: 'carbon-and-fluent-spent-not-valid-confirmatory-holdouts-for-M2',
  },
} as const;

const RECORDS_FIXED = {
  sceneManifest: 'fixtures/paired-theme/common-scenes.v1.json',
  systems: FROZEN_SYSTEMS, identity: 'system/sceneId/paintId',
  aggregationCells: {
    colorRoleScene: ['background/surface-stack', 'surface/surface-stack', 'text/surface-stack',
      'surface/table-selection', 'accent/table-selection', 'text/table-selection',
      'border/form-focus', 'accent/form-focus', 'surface/status-alert', 'text/status-alert'],
    contrastRoleScene: ['text/surface-stack', 'accent/table-selection', 'text/table-selection',
      'border/form-focus', 'accent/form-focus', 'text/status-alert'],
    rankScenes: ['surface-stack', 'table-selection', 'status-alert'],
    emptyCellPolicy: 'a-preregistered-empty-cell-invalidates-the-run',
  },
  totals: {
    systems: 5, scenesPerSystem: 4, paintsPerVariant: 15, observationsPerSystem: 45,
    reviewedPerSystem: 10, totalReviewedRows: 50, colorRowsPerSystem: 10,
    totalColorRows: 50, contrastRowsPerSystem: 6, totalContrastRows: 30,
    rankRowsPerSystem: 3, totalRankRows: 15,
  },
  missingPolicy: 'invalidate-run', extraPolicy: 'invalidate-run',
  duplicatePolicy: 'invalidate-run',
  abstentionPolicy: 'score-unchanged-light-paint; extraction-failure-is-not-abstention',
} as const;

export interface FrozenMetricSpec {
  $schema: './metric-spec.schema.json';
  schema: 'semantic-dark.paired-theme-metric-spec.v1'; id: 'semantic-dark.paired-theme-metric.v1';
  version: 1; status: 'frozen';
  baseline: {m0Manifest: string; m0ManifestSha256: string; engineCommit: string;
    roleProfilesSource: string; roleProfilesSourceSha256: string; roleProfilesCanonicalSha256: string};
  sources: readonly {system: PairedThemeSystem; split: 'reference' | 'held-out'; protocol: string;
    package: {name: string; version: string; integrity: string; license: string; repository: string};
    mappingPolicy: string}[];
  records: typeof RECORDS_FIXED & {sceneManifestSha256: string; reviewed: readonly unknown[];
    contrast: readonly unknown[]; rank: readonly unknown[]};
  colorPipeline: typeof FIXED.colorPipeline; primary: typeof FIXED.primary;
  secondary: typeof FIXED.secondary; safety: typeof FIXED.safety; m2Gate: typeof FIXED.m2Gate;
  reportContract: typeof FIXED.reportContract;
  implementationPins: {files: readonly {path: string; sha256: string}[]};
  heldOutAccessPolicy: typeof FIXED.heldOutAccessPolicy;
}

export function validateFrozenMetricSpec(value: unknown): FrozenMetricSpec {
  const input = object(value, 'metric spec');
  exactKeys(input, ['$schema', 'schema', 'id', 'version', 'status', 'baseline', 'sources', 'records',
    'colorPipeline', 'primary', 'secondary', 'safety', 'm2Gate', 'reportContract',
    'implementationPins', 'heldOutAccessPolicy'], 'metric spec');
  literal(input.$schema, './metric-spec.schema.json', '$schema');
  literal(input.schema, 'semantic-dark.paired-theme-metric-spec.v1', 'schema');
  literal(input.id, 'semantic-dark.paired-theme-metric.v1', 'id');
  literal(input.version, 1, 'version'); literal(input.status, 'frozen', 'status');
  validateBaseline(input.baseline); validateSources(input.sources); validateRecords(input.records);
  for (const key of ['colorPipeline', 'primary', 'secondary', 'safety', 'm2Gate',
    'reportContract', 'heldOutAccessPolicy'] as const) deepExact(input[key], FIXED[key], key);
  validatePins(input.implementationPins);
  return input as unknown as FrozenMetricSpec;
}

function validateBaseline(value: unknown): void {
  const item = object(value, 'baseline');
  exactKeys(item, ['m0Manifest', 'm0ManifestSha256', 'engineCommit', 'roleProfilesSource',
    'roleProfilesSourceSha256', 'roleProfilesCanonicalSha256'], 'baseline');
  literal(item.m0Manifest, 'fixtures/evaluation/m0-manifest.v1.json', 'baseline.m0Manifest');
  literal(item.roleProfilesSource, 'src/color/dark-map.ts', 'baseline.roleProfilesSource');
  digest(item.m0ManifestSha256, 'baseline.m0ManifestSha256');
  digest(item.roleProfilesSourceSha256, 'baseline.roleProfilesSourceSha256');
  digest(item.roleProfilesCanonicalSha256, 'baseline.roleProfilesCanonicalSha256');
  if (typeof item.engineCommit !== 'string' || !COMMIT.test(item.engineCommit)) {
    throw new Error('baseline.engineCommit must be a 40-character lowercase commit');
  }
}

function validateSources(value: unknown): void {
  if (!Array.isArray(value) || value.length !== SOURCE_CONTRACT.length) throw new Error('sources must contain exactly five systems');
  value.forEach((raw, index) => {
    const item = object(raw, `sources[${index}]`); const expected = SOURCE_CONTRACT[index]!;
    exactKeys(item, ['system', 'split', 'protocol', 'package', 'mappingPolicy'], `sources[${index}]`);
    literal(item.system, expected[0], `sources[${index}].system`);
    literal(item.split, expected[1], `sources[${index}].split`);
    literal(item.protocol, expected[2], `sources[${index}].protocol`);
    literal(item.mappingPolicy, expected[8], `sources[${index}].mappingPolicy`);
    const pkg = object(item.package, `sources[${index}].package`);
    exactKeys(pkg, ['name', 'version', 'integrity', 'license', 'repository'], `sources[${index}].package`);
    literal(pkg.name, expected[3], `sources[${index}].package.name`);
    literal(pkg.version, expected[4], `sources[${index}].package.version`);
    literal(pkg.integrity, expected[5], `sources[${index}].package.integrity`);
    literal(pkg.license, expected[6], `sources[${index}].package.license`);
    literal(pkg.repository, expected[7], `sources[${index}].package.repository`);
  });
}

function validateRecords(value: unknown): void {
  const item = object(value, 'records');
  exactKeys(item, ['sceneManifest', 'sceneManifestSha256', 'systems', 'identity', 'reviewed',
    'contrast', 'rank', 'aggregationCells', 'totals', 'missingPolicy', 'extraPolicy',
    'duplicatePolicy', 'abstentionPolicy'], 'records');
  digest(item.sceneManifestSha256, 'records.sceneManifestSha256');
  for (const [key, expected] of Object.entries(RECORDS_FIXED)) deepExact(item[key], expected, `records.${key}`);
  inventory(item.reviewed, REVIEWED, ['sceneId', 'paintId', 'role', 'token'], 'reviewed');
  inventory(item.contrast, CONTRAST, ['sceneId', 'paintId', 'role', 'kind', 'backdropPaintId'], 'contrast');
  inventory(item.rank, RANK, ['sceneId', 'pairId', 'lowerPaintId', 'upperPaintId'], 'rank');
}

function validatePins(value: unknown): void {
  const item = object(value, 'implementationPins'); exactKeys(item, ['files'], 'implementationPins');
  if (!Array.isArray(item.files) || item.files.length !== FROZEN_IMPLEMENTATION_PATHS.length) {
    throw new Error(`implementationPins.files must contain exactly ${FROZEN_IMPLEMENTATION_PATHS.length} pins`);
  }
  const paths = new Set<string>();
  item.files.forEach((raw, index) => {
    const pin = object(raw, `implementationPins.files[${index}]`);
    exactKeys(pin, ['path', 'sha256'], `implementationPins.files[${index}]`);
    nonEmpty(pin.path, `implementationPins.files[${index}].path`); digest(pin.sha256, `implementationPins.files[${index}].sha256`);
    literal(pin.path, FROZEN_IMPLEMENTATION_PATHS[index], `implementationPins.files[${index}].path`);
    if (paths.has(pin.path as string)) throw new Error(`duplicate implementation pin: ${pin.path}`);
    paths.add(pin.path as string);
  });
}

function inventory(value: unknown, rows: readonly (readonly string[])[], fields: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== rows.length) throw new Error(`${label} inventory must contain exactly ${rows.length} rows`);
  value.forEach((raw, index) => {
    const item = object(raw, `${label}[${index}]`); exactKeys(item, fields, `${label}[${index}]`);
    fields.forEach((field, fieldIndex) => literal(item[field], rows[index]![fieldIndex], `${label}[${index}].${field}`));
  });
}

function deepExact(actual: unknown, expected: unknown, label: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(`${label} does not match the frozen contract`);
    expected.forEach((item, index) => deepExact(actual[index], item, `${label}[${index}]`)); return;
  }
  if (expected !== null && typeof expected === 'object') {
    const record = object(actual, label); const shape = expected as Record<string, unknown>;
    exactKeys(record, Object.keys(shape), label);
    for (const [key, item] of Object.entries(shape)) deepExact(record[key], item, `${label}.${key}`);
    return;
  }
  literal(actual, expected, label);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label} has unknown or missing keys: ${actual.join(', ')}`);
}

function literal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} must equal ${String(expected)}`);
}

function digest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function nonEmpty(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}
