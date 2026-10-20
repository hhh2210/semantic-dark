import {chmod, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';

import {serializeCanonicalJson, sha256File, sha256Text} from '../../src/testing/artifacts';
import {loadV2EvaluationContract, type ValidatedV2EvaluationContract}
  from '../../src/testing/paired-theme/v2/contract';
import {
  buildV2ExposureBinding,
  loadFrozenV2ExecutionEvidence,
} from '../../src/testing/paired-theme/v2/exposure-contract';
import {
  assertV2ExposureReceiptMatchesBinding,
  createInternalV2ExposureTestStore,
  persistV2ExposureCompletion,
  prepareV2Exposure,
  resolveV2EvidencePaths,
  validateV2ExposureBinding,
  validateV2ExposureCompletion,
  validateV2ExposureReceipt,
  verifyPersistedV2ExposureEvidence,
  v2ExposureClaimId,
  type V2ExposureBinding,
  type V2ExposureStore,
} from '../../src/testing/paired-theme/v2/exposure';
import {V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA, V2_METRIC_PAYLOAD_COUNT_SCHEMA,
  type FrozenV2ExecutionEvidence} from '../../src/testing/paired-theme/v2/exposure-types';
import {__v2ExposureSupervisorTestSeam}
  from '../../src/testing/paired-theme/v2/supervisor';
import {makeV2SpecFixture, type V2SpecFixture} from './helpers/v2-spec-fixture';

const roots: string[] = [];
const SHA_A = 'a'.repeat(64); const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64); const SHA_D = 'd'.repeat(64);
let fixture: V2SpecFixture;
let contract: ValidatedV2EvaluationContract;
let evidence: FrozenV2ExecutionEvidence;

beforeAll(async () => {
  fixture = await makeV2SpecFixture();
  contract = await loadV2EvaluationContract(fixture.options);
  const document = {schema: V2_FROZEN_EXECUTION_EVIDENCE_SCHEMA, status: 'frozen',
    profiles: {baseline: {semanticSha256: SHA_A, fileSha256: SHA_B},
      candidate: {semanticSha256: SHA_C, fileSha256: SHA_D}},
    candidateFreezeCommit: 'a'.repeat(40), evaluatorCommit: 'b'.repeat(40),
    engineCommit: 'c'.repeat(40)};
  const bytes = serializeCanonicalJson(document);
  const evidencePath = path.join(fixture.root, 'fixtures/evaluation/frozen-execution.v2.json');
  await writeFile(evidencePath, bytes);
  evidence = await loadFrozenV2ExecutionEvidence({repoRoot: fixture.root, evidencePath,
    expectedSha256: sha256Text(bytes)});
});
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, {recursive: true, force: true}))));
afterAll(async () => rm(fixture.root, {recursive: true, force: true}));

describe('v2 held-out exposure evidence', () => {
  it('does not turn raw validated data or fake prepared objects into capabilities', async () => {
    const binding = fixtureBinding();
    const raw = JSON.parse(JSON.stringify(binding));
    expect(validateV2ExposureBinding(raw)).toEqual(raw);
    await expect(prepareV2Exposure(raw as V2ExposureBinding,
      {store: temporaryStore('raw')})).rejects.toThrow(/contract-derived branded binding/);
    await expect(prepareV2Exposure(binding, {now: () => new Date(0)}))
      .rejects.toThrow(/forbids test-only/);
    await expect(persistV2ExposureCompletion({} as never, {})).rejects
      .toThrow(/live prepared exposure capability/);
  });

  it('claims before spawn and accepts only the exact 19-row count per arm', async () => {
    const store = temporaryStore('success'); const binding = fixtureBinding();
    const claimId = v2ExposureClaimId(binding);
    const completion = await runWorker(binding, store,
      artifactScript(binding, 19, "process.stdout.write('stdout-proof\\n');"), 1);
    expect(completion.status).toBe('completed');
    expect(completion.metricPayloadCountKnown).toBe(true);
    expect(completion.metricPayloadCountValid).toBe(true);
    expect(completion.failureKinds).toEqual([]);
    expect(await readFile(completion.log.path, 'utf8')).toContain('stdout-proof');
    expect(completion.log.sha256).toBe(await sha256File(completion.log.path));
    expect((await stat(completion.log.path)).mode & 0o777).toBe(0o400);
    const persisted = await verifyPersistedV2ExposureEvidence(claimId, store);
    expect(assertV2ExposureReceiptMatchesBinding(persisted.receipt, binding))
      .toEqual(persisted.receipt);
    expect(persisted.completion).toEqual(completion);
    const paths = resolveV2EvidencePaths(store);
    expect((await stat(paths.claimsDirectory)).mode & 0o777).toBe(0o700);
    for (const evidencePath of [path.join(paths.claimsDirectory, `${claimId}.json`),
      path.join(paths.completionsDirectory, `${claimId}.json`), completion.log.path]) {
      const info = await stat(evidencePath);
      expect(info.mode & 0o777).toBe(0o400);
      if (process.getuid !== undefined) expect(info.uid).toBe(process.getuid());
    }
  });

  it('never releases a signal-consumed claim and preserves exact zero counts', async () => {
    const store = temporaryStore('signal'); const binding = fixtureBinding();
    const completion = await runWorker(binding, store, artifactScript(binding, 0,
      "process.stdout.write('before-signal\\n');process.kill(process.pid,'SIGTERM');"), 2);
    expect(completion.status).toBe('failed');
    expect(completion.process.signal).toBe('SIGTERM');
    expect(completion.metricPayloadCountKnown).toBe(true);
    expect(completion.metricPayloadCountValid).toBe(false);
    expect(completion.failureKinds).toEqual(expect.arrayContaining(['signal', 'metric-payload-count']));
    await expect(runWorker(binding, store, artifactScript(binding, 19, ''), 3))
      .rejects.toMatchObject({code: 'EEXIST'});
  });

  it('distinguishes unknown, known-partial, and valid metric accounting', async () => {
    const unknown = await runWorker(fixtureBinding(), temporaryStore('unknown'),
      "process.stdout.write('no-artifact\\n')", 4);
    expect([unknown.metricPayloadCountKnown, unknown.metricPayloadCountValid])
      .toEqual([false, false]);
    expect(unknown.metricPayloadCount.flatMap(({arms}) => arms)
      .every(({count}) => count === null)).toBe(true);

    const binding = fixtureBinding();
    const partial = await runWorker(binding, temporaryStore('partial'),
      artifactScript(binding, 7, ''), 5);
    expect([partial.metricPayloadCountKnown, partial.metricPayloadCountValid])
      .toEqual([true, false]);
    expect(partial.failureKinds).toContain('metric-payload-count');
  });

  it('best-effort persists a failure completion after a post-claim spawn error', async () => {
    const store = temporaryStore('spawn-error'); const binding = fixtureBinding();
    const completion = await __v2ExposureSupervisorTestSeam.run(binding,
      {command: '/definitely/missing/semantic-dark-v2-worker'}, {store,
        logIdFactory: () => '00000000-0000-4000-8000-000000000015'});
    expect(completion.status).toBe('failed');
    expect(completion.failureKinds).toEqual(expect.arrayContaining(
      ['spawn-error', 'metric-payload-count']));
    expect(completion.metricPayloadCountKnown).toBe(false);
    await expect(verifyPersistedV2ExposureEvidence(v2ExposureClaimId(binding), store))
      .resolves.toEqual(expect.objectContaining({completion}));
  });

  it('allows exactly one concurrent claimant to spawn', async () => {
    const store = temporaryStore('concurrent'); const binding = fixtureBinding();
    const marker = path.join(store.rootDirectory, 'protected-actions');
    const script = artifactScript(binding, 19,
      `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x')`);
    const results = await Promise.allSettled([
      runWorker(binding, store, script, 6), runWorker(binding, store, script, 7),
    ]);
    expect(results.filter(({status}) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({status}) => status === 'rejected')).toHaveLength(1);
    expect(await readFile(marker, 'utf8')).toBe('x');
  });

  it('derives verifier paths from claimId and rejects symlink substitution', async () => {
    const store = temporaryStore('symlink'); const binding = fixtureBinding();
    await runWorker(binding, store, artifactScript(binding, 19, ''), 8);
    const claimId = v2ExposureClaimId(binding); const paths = resolveV2EvidencePaths(store);
    const completionPath = path.join(paths.completionsDirectory, `${claimId}.json`);
    const saved = `${completionPath}.saved`;
    await writeFile(saved, await readFile(completionPath)); await chmod(saved, 0o400);
    await rm(completionPath); await symlink(saved, completionPath);
    await expect(verifyPersistedV2ExposureEvidence(claimId, store))
      .rejects.toThrow(/regular no-follow file/);
  });

  it('enforces exact runtime shapes and updated strict schemas', async () => {
    const store = temporaryStore('schemas'); const binding = fixtureBinding();
    const completion = await runWorker(binding, store, artifactScript(binding, 19, ''), 9);
    const receipt = (await verifyPersistedV2ExposureEvidence(
      v2ExposureClaimId(binding), store)).receipt;
    expect(() => validateV2ExposureReceipt({...receipt, unexpected: true}))
      .toThrow(/unexpected shape/);
    expect(() => validateV2ExposureCompletion({...completion,
      metricPayloadCountKnown: false}, receipt)).toThrow(/known\/valid flags/);
    const receiptSchema = JSON.parse(await readFile(path.join(process.cwd(),
      'fixtures/evaluation/held-out-exposure-receipt.v2.schema.json'), 'utf8'));
    const completionSchema = JSON.parse(await readFile(path.join(process.cwd(),
      'fixtures/evaluation/held-out-exposure-completion.v2.schema.json'), 'utf8'));
    expect(receiptSchema.properties.expectedMetricPayloadCountPerArm.const).toBe(19);
    expect(completionSchema.required).toEqual(expect.arrayContaining(
      ['metricPayloadCountKnown', 'metricPayloadCountValid']));
    expect(completionSchema.additionalProperties).toBe(false);
  });

  it('uses a pair-global claim id despite spec, order, and candidate changes', () => {
    const original = fixtureBinding();
    const changed = {...JSON.parse(JSON.stringify(original)), metricSpecSha256: SHA_D,
      holdouts: [...original.holdouts].reverse(),
      expectedMetricPayloadCountPerArm: 23,
      profiles: {...original.profiles, candidate: {semanticSha256: SHA_B, fileSha256: SHA_A}}};
    expect(v2ExposureClaimId(changed)).toBe(v2ExposureClaimId(original));
  });
});

function fixtureBinding(): V2ExposureBinding { return buildV2ExposureBinding(contract, evidence); }
function temporaryStore(suffix: string): V2ExposureStore {
  const root = path.join(tmpdir(), `semantic-dark-v2-exposure-${process.pid}-${suffix}-${roots.length}`);
  roots.push(root); return createInternalV2ExposureTestStore(root);
}
function artifactScript(binding: V2ExposureBinding, count: number, tail: string): string {
  const artifact = {schema: V2_METRIC_PAYLOAD_COUNT_SCHEMA,
    claimId: v2ExposureClaimId(binding), systems: binding.holdouts.map(({id}) => ({systemId: id,
      arms: binding.variants.slice(2).map((armId) => ({armId, count}))}))};
  const bytes = serializeCanonicalJson(artifact);
  return `const fs=require('node:fs');const p=process.env.SEMANTIC_DARK_V2_METRIC_PAYLOAD_PATH;` +
    `if(!fs.existsSync(process.env.SEMANTIC_DARK_V2_RECEIPT_PATH))process.exit(91);` +
    `fs.writeFileSync(p,${JSON.stringify(bytes)},{flag:'wx',mode:0o400});` + tail;
}
function runWorker(binding: V2ExposureBinding, store: V2ExposureStore, script: string, id: number) {
  return __v2ExposureSupervisorTestSeam.run(binding,
    {command: process.execPath, args: ['-e', script]}, {store,
      now: () => new Date('2026-07-19T01:02:03.000Z'), pid: 7001,
      logIdFactory: () => `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`});
}
