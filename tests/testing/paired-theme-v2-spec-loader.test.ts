import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

import {
  assertValidatedV2EvaluationContract,
  loadV2EvaluationContract,
  validateV2EvaluationContract,
} from '../../src/testing/paired-theme/v2/contract';
import {loadValidatedV2MetricSpec} from '../../src/testing/paired-theme/v2/spec';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  sha256,
  type V2SpecFixture,
} from './helpers/v2-spec-fixture';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, {recursive: true, force: true}))));

describe('paired-theme v2 trusted metric-spec boundary', () => {
  it('derives the complete immutable evaluator contract only from pinned bytes', async () => {
    const fixture = await makeFixture();
    const contract = await loadV2EvaluationContract(fixture.options);

    expect(contract.metricSpecSha256).toBe(fixture.options.expectedSha256);
    expect(contract.developmentSystemIds).toEqual([
      'material', 'primer', 'spectrum', 'carbon', 'fluent',
    ]);
    expect(contract.primaryHoldoutSystemIds).toEqual(['holdout-one', 'holdout-two']);
    expect(contract.reserveSystemIds).toEqual(['reserve-one', 'reserve-two']);
    expect(contract.confirmation).toEqual({
      primary: {id: 'primary-v2', systems: ['holdout-one', 'holdout-two']},
      reserves: [{id: 'reserve-v2-1', systems: ['reserve-one', 'reserve-two']}],
    });
    expect(contract.activeSystemIds).toHaveLength(7);
    expect(contract.variants.ordered).toEqual([
      'light', 'authored-dark', 'baseline-candidate', 'm2-candidate',
    ]);
    expect(contract.denominators).toMatchObject({
      rawObservationsPerSystemPerReplicate: 60,
      rawObservationsPerSystemAcrossReplicates: 120,
      perArm: {reviewed: 10, color: 10, contrast: 6, rank: 3},
      comparison: {color: 20, contrast: 12, rank: 6},
      reviewedSystems: 7,
      totalReviewedRows: 70,
    });
    expect(contract.metric).toMatchObject({status: 'frozen-v2', comparisonEpsilon: 0});
    expect(contract.componentNonRegressionTolerance).toBe(1e-12);
    expect(contract.systems[0]).toMatchObject({
      adapterId: 'material-adapter',
      protocolPath: 'fixtures/protocols/material.json',
      sceneManifestPath: 'fixtures/scenes.json',
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.systems[0])).toBe(true);
    expect(Object.isFrozen(contract.metric.componentWeights)).toBe(true);
  });

  it('rejects caller-authored contracts and forged brands', () => {
    const raw = {metricSpecSha256: 'a'.repeat(64)};
    expect(() => validateV2EvaluationContract(raw)).toThrow(/Raw v2 contract construction is forbidden/);
    expect(() => assertValidatedV2EvaluationContract(raw as never))
      .toThrow(/loaded from pinned metric-spec bytes/);
  });

  it('checks the external byte pin before parsing and rejects later byte drift', async () => {
    const fixture = await makeFixture();
    await writeFile(path.join(fixture.root, fixture.options.specPath), '{');
    await expect(loadValidatedV2MetricSpec(fixture.options)).rejects.toThrow(/SHA-256 mismatch/);

    const invalidSha = sha256(await readFile(path.join(fixture.root, fixture.options.specPath)));
    await expect(loadValidatedV2MetricSpec({...fixture.options, expectedSha256: invalidSha}))
      .rejects.toThrow(/JSON is invalid/);
  });

  it('rejects semantic overrides and unknown nested fields', async () => {
    const fixture = await makeFixture();
    await expect(loadV2EvaluationContract({
      ...fixture.options,
      systems: [{id: 'injected'}],
    } as never)).rejects.toThrow(/load options has an unexpected shape/);

    const changed = structuredClone(fixture.document) as Record<string, any>;
    changed.evaluationContract.registryOverride = [];
    await expect(loadChangedV2Spec(fixture, changed)).rejects.toThrow(
      /evaluationContract has an unexpected shape/,
    );

    const leaked = structuredClone(fixture.document) as Record<string, any>;
    leaked.registry.systems[0].tokenValues = {canvas: '#fff'};
    await expect(loadChangedV2Spec(fixture, leaked)).rejects.toThrow(
      /registry.systems\[0\] has an unexpected shape/,
    );
  });

  it('enforces the frozen variants, denominators, metric, and registry cardinality', async () => {
    const fixture = await makeFixture();
    const cases: [string, (value: Record<string, any>) => void, RegExp][] = [
      ['variant', (value) => { value.evaluationContract.variants.ordered[3] = 'candidate'; },
        /four frozen conditions/],
      ['raw count', (value) => {
        value.evaluationContract.denominators.rawObservationsPerSystemPerReplicate = 59;
      }, /rawObservationsPerSystemPerReplicate must equal 60/],
      ['render tolerance', (value) => {
        value.evaluationContract.metric.comparisonEpsilon = 1e-7;
      }, /comparisonEpsilon must equal 0/],
      ['registry', (value) => { value.registry.systems.pop(); },
        /complete reserve pairs/],
    ];
    for (const [, mutate, message] of cases) {
      const changed = structuredClone(fixture.document) as Record<string, any>;
      mutate(changed);
      await expect(loadChangedV2Spec(fixture, changed)).rejects.toThrow(message);
    }
  });

  it('verifies every protocol and scene pin before producing a contract', async () => {
    const fixture = await makeFixture();
    await writeFile(path.join(fixture.root, 'fixtures/protocols/material.json'), '{"drift":true}');
    await expect(loadV2EvaluationContract(fixture.options))
      .rejects.toThrow(/material protocol SHA-256 mismatch/);
  });

  it('rejects spec and referenced-file symlinks that escape the repository', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'semantic-dark-v2-outside-'));
    roots.push(outside);
    const outsideSpec = path.join(outside, 'metric.json');
    await writeFile(outsideSpec, '{}');

    const fixture = await makeFixture();
    const linkedSpec = path.join(fixture.root, 'fixtures/evaluation/linked.json');
    await symlink(outsideSpec, linkedSpec);
    await expect(loadValidatedV2MetricSpec({
      repoRoot: fixture.root,
      specPath: 'fixtures/evaluation/linked.json',
      expectedSha256: sha256('{}'),
    })).rejects.toThrow(/escapes repository root/);

    const protocol = path.join(fixture.root, 'fixtures/protocols/material.json');
    await rm(protocol);
    await symlink(outsideSpec, protocol);
    await expect(loadV2EvaluationContract(fixture.options))
      .rejects.toThrow(/escapes repository root/);
  });
});

async function makeFixture(): Promise<V2SpecFixture> {
  const fixture = await makeV2SpecFixture();
  roots.push(fixture.root);
  return fixture;
}
