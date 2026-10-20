import {rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {serializeCanonicalJson, sha256Text} from '../../src/testing/artifacts';
import {loadV2EvaluationContract, type ValidatedV2EvaluationContract}
  from '../../src/testing/paired-theme/v2/contract';
import {
  assertAuthorizedV2ExposureClaim,
  assertContractDerivedV2ExposureBinding,
  buildV2ExposureBinding,
  loadAuthorizedV2ExposureClaim,
  loadFrozenV2ExecutionEvidence,
} from '../../src/testing/paired-theme/v2/exposure-contract';
import {
  createInternalV2ExposureTestStore,
  prepareV2Exposure,
  type V2ExposureBinding,
  type V2ExposureStore,
} from '../../src/testing/paired-theme/v2/exposure';
import {V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA, type FrozenV2ExecutionEvidence} from '../../src/testing/paired-theme/v2/exposure-types';
import {makeV2SpecFixture, type V2SpecFixture} from './helpers/v2-spec-fixture';

const SHA_A = 'a'.repeat(64); const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64); const SHA_D = 'd'.repeat(64);
let fixture: V2SpecFixture;
let contract: ValidatedV2EvaluationContract;
let evidence: FrozenV2ExecutionEvidence;
const roots: string[] = [];

beforeAll(async () => {
  fixture = await makeV2SpecFixture();
  contract = await loadV2EvaluationContract(fixture.options);
  evidence = await writeAndLoadEvidence('a'.repeat(40));
});
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, {recursive: true, force: true})));
  await rm(fixture.root, {recursive: true, force: true});
});

describe('contract-derived v2 exposure authorization', () => {
  it('loads pins only from externally hashed bytes and derives the fixed primary', async () => {
    const binding = buildV2ExposureBinding(contract, evidence);
    expect(binding.holdouts.map(({id}) => id)).toEqual(['holdout-one', 'holdout-two']);
    expect(binding.variants).toEqual(contract.variants.ordered);
    expect(binding.expectedMetricPayloadCountPerArm).toBe(19);
    expect(() => assertContractDerivedV2ExposureBinding(binding)).not.toThrow();
    expect(() => assertContractDerivedV2ExposureBinding(
      JSON.parse(JSON.stringify(binding)) as V2ExposureBinding))
      .toThrow(/contract-derived branded binding/);
    expect(() => buildV2ExposureBinding(contract, {} as FrozenV2ExecutionEvidence))
      .toThrow(/externally pinned bytes/);

    const evidencePath = path.join(fixture.root, 'fixtures/evaluation/frozen-a.json');
    await expect(loadFrozenV2ExecutionEvidence({repoRoot: fixture.root, evidencePath,
      expectedSha256: SHA_A})).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('reauthorizes only persisted exact primary receipt bytes', async () => {
    const store = temporaryStore('authorized');
    const prepared = await prepareV2Exposure(buildV2ExposureBinding(contract, evidence),
      {store, logIdFactory: () => '00000000-0000-4000-8000-000000000010'});
    const claim = await loadAuthorizedV2ExposureClaim(contract, evidence, store);
    expect(claim.receiptPath).toBe(prepared.receiptPath);
    expect(claim.group.id).toBe('primary-v2');
    expect(() => assertAuthorizedV2ExposureClaim(claim)).not.toThrow();
    expect(() => assertAuthorizedV2ExposureClaim({} as never))
      .toThrow(/persisted contract-matching claim/);
    await prepared.logHandle.close();

    const changed = await writeAndLoadEvidence('d'.repeat(40));
    await expect(loadAuthorizedV2ExposureClaim(contract, changed, store))
      .rejects.toThrow(/does not match the protected execution binding/);
  });
});

async function writeAndLoadEvidence(candidateCommit: string) {
  const document = {schema: V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA, status: 'frozen',
    profiles: {baseline: {semanticSha256: SHA_A, fileSha256: SHA_B},
      candidate: {semanticSha256: SHA_C, fileSha256: SHA_D}},
    candidateFreezeCommit: candidateCommit, evaluatorCommit: 'b'.repeat(40),
    engineCommit: 'c'.repeat(40)};
  const bytes = serializeCanonicalJson(document);
  const evidencePath = path.join(fixture.root, 'fixtures/evaluation', `frozen-${candidateCommit[0]}.json`);
  await writeFile(evidencePath, bytes);
  return loadFrozenV2ExecutionEvidence({repoRoot: fixture.root, evidencePath,
    expectedSha256: sha256Text(bytes)});
}
function temporaryStore(suffix: string): V2ExposureStore {
  const root = path.join(tmpdir(), `semantic-dark-v2-contract-${process.pid}-${suffix}-${roots.length}`);
  roots.push(root); return createInternalV2ExposureTestStore(root);
}
