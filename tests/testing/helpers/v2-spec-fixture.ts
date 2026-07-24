import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {loadV2EvaluationContract} from '../../../src/testing/paired-theme/v2/contract';

export interface V2SpecFixture {
  root: string;
  options: {repoRoot: string; specPath: string; expectedSha256: string};
  document: Record<string, any>;
}

export async function makeV2SpecFixture(): Promise<V2SpecFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'semantic-dark-v2-spec-'));
  await mkdir(path.join(root, 'fixtures/evaluation'), {recursive: true});
  await mkdir(path.join(root, 'fixtures/protocols'), {recursive: true});
  const sceneBytes = '{"schema":"test-scenes"}\n';
  await writeFile(path.join(root, 'fixtures/scenes.json'), sceneBytes);
  const systems = [
    ...['material', 'primer', 'spectrum', 'carbon', 'fluent'].map((id) =>
      ({id, split: 'development', purpose: 'development'})),
    ...['holdout-one', 'holdout-two'].map((id) =>
      ({id, split: 'held-out', purpose: 'primary-holdout'})),
    ...['reserve-one', 'reserve-two'].map((id) =>
      ({id, split: 'held-out', purpose: 'reserve'})),
  ];
  const registry = [];
  for (const system of systems) {
    const protocolPath = `fixtures/protocols/${system.id}.json`;
    const protocolBytes = `${JSON.stringify({id: system.id})}\n`;
    await writeFile(path.join(root, protocolPath), protocolBytes);
    registry.push({
      ...system,
      adapterId: `${system.id}-adapter`,
      protocolPath,
      protocolSha256: sha256(protocolBytes),
      sceneManifestPath: 'fixtures/scenes.json',
      sceneManifestSha256: sha256(sceneBytes),
    });
  }
  const document = v2SpecDocument(registry);
  const specPath = 'fixtures/evaluation/metric-spec.v2.json';
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(path.join(root, specPath), bytes);
  return {root, document, options: {repoRoot: root, specPath, expectedSha256: sha256(bytes)}};
}

export function v2SpecDocument(systems: Record<string, unknown>[]): Record<string, any> {
  const sceneManifestPath = systems[0]!.sceneManifestPath as string;
  const sceneManifestSha256 = systems[0]!.sceneManifestSha256 as string;
  return {
    $schema: './metric-spec.v2.schema.json',
    schema: 'semantic-dark.paired-theme-metric-spec.v2',
    id: 'semantic-dark.paired-theme-metric.v2', version: 2, status: 'frozen',
    baseline: {schema: 'baseline-v2'},
    registry: {
      systems,
      confirmation: {
        primary: {id: 'primary-v2', systems: ['holdout-one', 'holdout-two']},
        reserves: [{id: 'reserve-v2-1', systems: ['reserve-one', 'reserve-two']}],
      },
    },
    records: recordsSection(sceneManifestPath, sceneManifestSha256),
    evaluationContract: {
      variants: {
        ordered: ['light', 'authored-dark', 'baseline-candidate', 'm2-candidate'],
        roles: {light: 'light', authoredDark: 'authored-dark',
          baselineCandidate: 'baseline-candidate', m2Candidate: 'm2-candidate'},
      },
      replicatesPerSystem: 2,
      denominators: {
        scenesPerSystem: 4, paintsPerVariant: 15,
        rawObservationsPerSystemPerReplicate: 60,
        rawObservationsPerSystemAcrossReplicates: 120,
        perArm: {reviewed: 10, color: 10, contrast: 6, rank: 3},
        comparison: {color: 20, contrast: 12, rank: 6},
        reviewedSystems: 7, totalReviewedRows: 70,
      },
      metric: {
        status: 'frozen-v2', deltaEOkCap: 0.1, contrastLog2Cap: 1,
        rankTieEpsilon: 0.01, comparisonEpsilon: 0, accentChromaThreshold: 0.02,
        textContrastFloor: 4.5, nonTextContrastFloor: 3, surfaceSeparationFloor: 1.12,
        componentWeights: {color: 1 / 3, contrast: 1 / 3, rank: 1 / 3},
      },
      componentNonRegressionTolerance: 1e-12,
    },
    humanReview: humanReviewSection(), tuning: tuningSection(),
    exposure: {schema: 'exposure-v2'}, implementationPins: {schema: 'pins-v2'},
  };
}

function recordsSection(sceneManifestPath: string, sceneManifestSha256: string) {
  const roles = ['background', 'surface', 'text', 'surface', 'accent',
    'text', 'border', 'accent', 'surface', 'text'];
  const reviewed = roles.map((role, index) => ({
    sceneId: `scene-${Math.floor(index / 3) + 1}`,
    paintId: `paint-${index + 1}`,
    role,
    token: `token-${index + 1}`,
  }));
  return {
    schema: 'semantic-dark.paired-theme-records.v2', sceneManifestPath, sceneManifestSha256,
    identity: 'system/sceneId/paintId',
    reviewed,
    contrast: reviewed.slice(0, 6).map((row, index) => ({
      sceneId: row.sceneId, paintId: row.paintId, role: row.role,
      kind: index % 2 === 0 ? 'text' : 'non-text', backdropPaintId: `backdrop-${index + 1}`,
    })),
    rank: [1, 2, 3].map((index) => ({sceneId: `scene-${index}`, pairId: `pair-${index}`,
      lowerPaintId: `lower-${index}`, upperPaintId: `upper-${index}`})),
    aggregationCells: {
      colorRoleScene: reviewed.map((row) => `${row.role}/${row.sceneId}/${row.paintId}`),
      contrastRoleScene: reviewed.slice(0, 6).map((row) => `${row.role}/${row.sceneId}/${row.paintId}`),
      rankScenes: ['scene-1', 'scene-2', 'scene-3'],
      emptyCellPolicy: 'a-preregistered-empty-cell-invalidates-the-run',
    },
    totals: {activeSystems: 7, reviewedPerSystem: 10, totalReviewedRows: 70,
      colorPerArm: 10, contrastPerArm: 6, rankPerArm: 3},
    missingPolicy: 'invalidate-run', extraPolicy: 'invalidate-run',
    duplicatePolicy: 'invalidate-run',
    abstentionPolicy: 'score-unchanged-light-paint; extraction-failure-is-not-abstention',
  };
}

function humanReviewSection() {
  const categories = ['native-dark', 'light-only', 'dynamic-mixed'];
  return {
    schema: 'semantic-dark.human-review.v2', reviewer: {count: 1, owner: 'project-owner'},
    cases: Array.from({length: 12}, (_, index) => ({
      id: `pilot-${String(index + 1).padStart(2, '0')}`,
      category: categories[Math.floor(index / 4)], states: ['default'],
      expectedThemeDecision: `Frozen decision ${index + 1}`,
      primaryTask: `Frozen task ${index + 1}`,
    })),
    blinding: {labels: ['A', 'B'], assignmentUnit: 'case',
      assignmentMethod: 'cryptographically-random-per-case',
      sealAlgorithm: 'sha256-canonical-json', sealedBefore: 'first-verdict',
      unblindAfter: 'all-cases-all-states-finalized', earlyUnblindingForbidden: true},
    severityRubric: {
      H1: 'Local aesthetic or hue/chroma regression without loss of meaning, readability, or interaction.',
      H2: 'The main task remains possible, but primary table hierarchy, focus/selected/disabled state, diagram tracking, or a large bright region is bad enough that a user must disable the extension.',
      H3: 'Primary content/control disappears or becomes unusable; status/chart meaning changes; protected media, logo, QR, or CAPTCHA is destructively recolored.',
    },
    reducer: 'worst-state-per-case',
    secondLook: {triggers: ['H2', 'H3'], reviewer: 'same-project-owner',
      requiredBeforeFinalization: true, requiredBeforeUnblinding: true},
    completion: {requiredCaseCount: 12, incompleteOutcome: 'not-evaluable',
      goPossibleWhenIncomplete: false},
    capturePolicy: {mode: 'local-manual-public-no-auth-no-crawl',
      rawCapturesStoredInGit: false, redistribution: false},
  };
}

function tuningSection() {
  return {
    schema: 'semantic-dark.profile-tuning.v2',
    developmentSystemIds: ['material', 'primer', 'spectrum', 'carbon', 'fluent'],
    solverPolicy: 'frozen-no-changes',
    searchSpace: {
      roles: ['background', 'surface', 'text', 'border', 'accent', 'svgFill', 'svgStroke'],
      fields: ['minimumLightness', 'lightnessSpan', 'chromaScale'],
      absoluteBounds: {minimumLightness: {minimum: 0, maximum: 0.9},
        lightnessSpan: {minimum: 0.02, maximum: 0.5}, chromaScale: {minimum: 0.4, maximum: 1}},
      coordinateDeltas: {minimumLightness: [-0.04, -0.02, 0, 0.02, 0.04],
        lightnessSpan: [-0.04, -0.02, 0, 0.02, 0.04],
        chromaScale: [-0.1, -0.05, 0, 0.05, 0.1]},
      constraints: ['minimumLightness+lightnessSpan<=1', 'all-values-finite'],
    },
    search: {method: 'deterministic-coordinate-descent', start: 'baseline-profile.v2',
      coordinateOrder: 'roles-then-fields-as-listed', maximumPasses: 4,
      stop: 'first-pass-with-no-accepted-coordinate-change', cacheKey: 'profile-semantic-sha256',
      tieBreak: 'maximin-improvement-vector-then-semantic-sha256'},
    objective: {kind: 'maximin-per-system-absolute-e-reduction',
      formula: 'min_s(E_baseline_s-E_candidate_s)', minimumImprovementPerSystem: 0.01,
      pooledAggregation: 'forbidden', componentNonRegressionTolerance: 1e-12,
      requireNoNewOrWorsenedF: true, requireM0InvariantsAndOpenFindingsNonRegression: true},
    selection: {finalCandidates: 1, qualifyingOnly: true,
      noQualifyingCandidate: 'stop-before-phase-c-and-report-no-go',
      productDefaultsChangeInsideGoal: false},
    planAmendment: 'original-failure-fixture-clause-replaced-by-frozen-development-margin',
  };
}

export async function loadChangedV2Spec(
  fixture: V2SpecFixture,
  document: Record<string, unknown>,
) {
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(path.join(fixture.root, fixture.options.specPath), bytes);
  return loadV2EvaluationContract({...fixture.options, expectedSha256: sha256(bytes)});
}

export async function currentV2SpecSha(fixture: V2SpecFixture): Promise<string> {
  return sha256(await readFile(path.join(fixture.root, fixture.options.specPath)));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
