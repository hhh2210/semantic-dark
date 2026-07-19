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
    records: {schema: 'records-v2'},
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
    humanReview: {schema: 'human-review-v2'}, tuning: {schema: 'tuning-v2'},
    exposure: {schema: 'exposure-v2'}, implementationPins: {schema: 'pins-v2'},
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
