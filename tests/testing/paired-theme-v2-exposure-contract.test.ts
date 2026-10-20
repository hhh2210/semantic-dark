import {readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {serializeCanonicalJson, sha256File, sha256Text} from '../../src/testing/artifacts';
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
  v2ExposureClaimId,
  type V2ExposureBinding,
  type V2ExposureStore,
} from '../../src/testing/paired-theme/v2/exposure';
import {V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA, V2_METRIC_PAYLOAD_COUNT_SCHEMA,
  type FrozenV2ExecutionEvidence} from '../../src/testing/paired-theme/v2/exposure-types';
import {
  assessV2PromotionEligibility,
  assertReportedV2Promotion,
  recordV2PromotionHumanReport,
} from '../../src/testing/paired-theme/v2/promotion';
import {__v2ExposureSupervisorTestSeam}
  from '../../src/testing/paired-theme/v2/supervisor';
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

  it('promotes only persisted primary infra failure with all exact-zero counts', async () => {
    const store = temporaryStore('promotion'); const binding = buildV2ExposureBinding(contract, evidence);
    await runWorker(binding, store, artifactScript(binding, 0,
      "process.kill(process.pid,'SIGTERM')"), 11);
    const assessment = await assessV2PromotionEligibility(contract, evidence, store);
    expect(assessment).toMatchObject({status: 'eligible-awaiting-human-report',
      primary: {id: 'primary-v2'}, promoted: {id: 'reserve-v2-1'}});
    if (assessment.status !== 'eligible-awaiting-human-report') throw new Error('expected eligibility');

    const badReportPath = path.join(store.rootDirectory, 'bad-human-report.json');
    await writeFile(badReportPath, '{"reported":true}\n', {mode: 0o400});
    await expect(recordV2PromotionHumanReport(assessment, {path: badReportPath,
      sha256: await sha256File(badReportPath)})).rejects.toThrow(/required notification/);

    const reportPath = path.join(store.rootDirectory, 'human-report.json');
    await writeFile(reportPath, serializeCanonicalJson({
      schema: 'semantic-dark.promotion-human-report.v2',
      status: 'reported-to-project-owner',
      primaryClaimId: assessment.primaryClaimId,
      reportedAt: '2026-07-19T01:02:04.000Z',
    }), {mode: 0o400});
    const reported = await recordV2PromotionHumanReport(assessment, {path: reportPath,
      sha256: await sha256File(reportPath)});
    expect(reported.status).toBe('human-reported-not-executed');
    expect(reported.promoted.systems).toEqual(['reserve-one', 'reserve-two']);
    expect((await stat(reported.markerPath)).mode & 0o777).toBe(0o400);
    expect(() => assertReportedV2Promotion(reported)).not.toThrow();
    expect(() => assertReportedV2Promotion({} as never)).toThrow(/global human-report/);
    await expect(recordV2PromotionHumanReport(assessment, {path: reportPath,
      sha256: await sha256File(reportPath)}))
      .rejects.toMatchObject({code: 'EEXIST'});
    await expect(assessV2PromotionEligibility(contract, evidence, store))
      .resolves.toEqual({status: 'ineligible', reason: 'promotion-already-recorded'});
  });

  it('rejects zero-count gate exits and unknown-count infrastructure failures', async () => {
    const exitStore = temporaryStore('gate-exit'); const binding = buildV2ExposureBinding(contract, evidence);
    await runWorker(binding, exitStore, artifactScript(binding, 0, 'process.exit(7)'), 12);
    await expect(assessV2PromotionEligibility(contract, evidence, exitStore))
      .resolves.toEqual({status: 'ineligible', reason: 'trigger-not-infrastructure'});

    const unknownStore = temporaryStore('unknown-infra');
    await runWorker(binding, unknownStore, "process.kill(process.pid,'SIGTERM')", 13);
    await expect(assessV2PromotionEligibility(contract, evidence, unknownStore))
      .resolves.toEqual({status: 'ineligible', reason: 'metric-count-not-exact-zero'});
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
function artifactScript(binding: V2ExposureBinding, count: number, tail: string): string {
  const artifact = {schema: V2_METRIC_PAYLOAD_COUNT_SCHEMA, claimId: v2ExposureClaimId(binding),
    systems: binding.holdouts.map(({id}) => ({systemId: id,
      arms: binding.variants.slice(2).map((armId) => ({armId, count}))}))};
  return `require('node:fs').writeFileSync(process.env.SEMANTIC_DARK_V2_METRIC_PAYLOAD_PATH,` +
    `${JSON.stringify(serializeCanonicalJson(artifact))},{flag:'wx',mode:0o400});${tail}`;
}
function runWorker(binding: V2ExposureBinding, store: V2ExposureStore, script: string, id: number) {
  return __v2ExposureSupervisorTestSeam.run(binding,
    {command: process.execPath, args: ['-e', script]}, {store,
      now: () => new Date('2026-07-19T01:02:03.000Z'), pid: 7001,
      logIdFactory: () => `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`});
}
