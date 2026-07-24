import {rm} from 'node:fs/promises';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {loadV2EvaluationContract} from '../../src/testing/paired-theme/v2/contract';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  type V2SpecFixture,
} from './helpers/v2-spec-fixture';

let fixture: V2SpecFixture;

beforeEach(async () => { fixture = await makeV2SpecFixture(); });
afterEach(async () => rm(fixture.root, {recursive: true, force: true}));

describe('metric-spec v2 normative section freeze', () => {
  it('loads immutable records, human-review, and tuning contracts from pinned bytes', async () => {
    const contract = await loadV2EvaluationContract(fixture.options);
    expect(contract.records).toMatchObject({
      schema: 'semantic-dark.paired-theme-records.v2',
      identity: 'system/sceneId/paintId',
      totals: {activeSystems: 7, reviewedPerSystem: 10, totalReviewedRows: 70},
    });
    expect(contract.records.reviewed).toHaveLength(10);
    expect(Object.isFrozen(contract.records.reviewed[0])).toBe(true);
  });

  it.each([
    ['record identity', (value: Record<string, any>) => {
      value.records.identity = 'system/paintId';
    }, /records.identity must equal system\/sceneId\/paintId/],
    ['record total', (value: Record<string, any>) => {
      value.records.totals.totalReviewedRows = 50;
    }, /totalReviewedRows must equal 70/],
    ['duplicate decision', (value: Record<string, any>) => {
      value.records.reviewed[1] = structuredClone(value.records.reviewed[0]);
    }, /decision list has duplicates/],
    ['unregistered scene pin', (value: Record<string, any>) => {
      value.records.sceneManifestSha256 = 'f'.repeat(64);
    }, /scene manifest must match every registered system/],
    ['contrast outside reviewed set', (value: Record<string, any>) => {
      value.records.contrast[0].paintId = 'not-reviewed';
    }, /Contrast record is not reviewed/],
  ])('rejects mutable A8 semantics: %s', async (_label, mutate, message) => {
    const changed = structuredClone(fixture.document);
    mutate(changed);
    await expect(loadChangedV2Spec(fixture, changed)).rejects.toThrow(message);
  });

  it.each([
    ['case count', (value: Record<string, any>) => { value.humanReview.cases.pop(); },
      /exactly 12 cases/],
    ['duplicate case state', (value: Record<string, any>) => {
      value.humanReview.cases[0].states = ['default', 'default'];
    }, /contains duplicates/],
    ['early unblinding', (value: Record<string, any>) => {
      value.humanReview.blinding.earlyUnblindingForbidden = false;
    }, /earlyUnblindingForbidden must equal true/],
    ['severity drift', (value: Record<string, any>) => {
      value.humanReview.severityRubric.H2 = 'Looks bad';
    }, /severityRubric.H2 must equal/],
    ['incomplete gate', (value: Record<string, any>) => {
      value.humanReview.completion.goPossibleWhenIncomplete = true;
    }, /goPossibleWhenIncomplete must equal false/],
    ['second-look removal', (value: Record<string, any>) => {
      value.humanReview.secondLook.triggers = ['H3'];
    }, /secondLook.triggers must equal H2, H3/],
  ])('rejects mutable A5 semantics: %s', async (_label, mutate, message) => {
    const changed = structuredClone(fixture.document);
    mutate(changed);
    await expect(loadChangedV2Spec(fixture, changed)).rejects.toThrow(message);
  });

  it.each([
    ['development system order', (value: Record<string, any>) => {
      value.tuning.developmentSystemIds.reverse();
    }, /developmentSystemIds must equal material, primer, spectrum, carbon, fluent/],
    ['solver mutation', (value: Record<string, any>) => {
      value.tuning.solverPolicy = 'allow-headroom-change';
    }, /solverPolicy must equal frozen-no-changes/],
    ['extra parameter', (value: Record<string, any>) => {
      value.tuning.searchSpace.fields.push('contrastFloor');
    }, /searchSpace.fields must equal/],
    ['search delta', (value: Record<string, any>) => {
      value.tuning.searchSpace.coordinateDeltas.chromaScale[4] = 0.2;
    }, /does not match the frozen search space/],
    ['pooled objective', (value: Record<string, any>) => {
      value.tuning.objective.pooledAggregation = 'mean';
    }, /pooledAggregation must equal forbidden/],
    ['margin', (value: Record<string, any>) => {
      value.tuning.objective.minimumImprovementPerSystem = 0;
    }, /minimumImprovementPerSystem must equal 0.01/],
    ['multiple candidates', (value: Record<string, any>) => {
      value.tuning.selection.finalCandidates = 2;
    }, /finalCandidates must equal 1/],
  ])('rejects mutable A6 semantics: %s', async (_label, mutate, message) => {
    const changed = structuredClone(fixture.document);
    mutate(changed);
    await expect(loadChangedV2Spec(fixture, changed)).rejects.toThrow(message);
  });
});
