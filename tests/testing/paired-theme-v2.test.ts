import {readFileSync} from 'node:fs';
import {rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {evaluateV2System} from '../../src/testing/paired-theme/v2/evaluate';
import {evaluateV2Arm} from '../../src/testing/paired-theme/v2/evaluate-arm';
import {
  aggregateDecisionLosses,
  aggregateDecisionLossesForRegistry,
  aggregateRankLossesForRegistry,
} from '../../src/testing/paired-theme/metric-reducers';
import {
  type ValidatedV2EvaluationContract,
} from '../../src/testing/paired-theme/v2/contract';
import {
  buildV2ObservationReplicate,
  type V2PaintObservation,
} from '../../src/testing/paired-theme/v2/observations';
import {
  loadV2RegisteredProtocol,
  type LoadedV2RegisteredProtocol,
} from '../../src/testing/paired-theme/v2/protocol';
import type {
  PaintDecision,
  SceneManifest,
} from '../../src/testing/paired-theme/types';
import {
  loadChangedV2Spec,
  makeV2SpecFixture,
  sha256,
  type V2SpecFixture,
} from './helpers/v2-spec-fixture';

const SCENES = (JSON.parse(readFileSync(path.join(
  process.cwd(), 'fixtures/paired-theme/common-scenes.v1.json',
), 'utf8')) as SceneManifest).scenes;

let fixture: V2SpecFixture;
let contract: ValidatedV2EvaluationContract;
let loaded: LoadedV2RegisteredProtocol;

beforeAll(async () => {
  fixture = await makeV2SpecFixture();
  const document = structuredClone(fixture.document) as Record<string, any>;
  const sceneBytes = readFileSync(path.join(
    process.cwd(), 'fixtures/paired-theme/common-scenes.v1.json',
  ));
  await writeFile(path.join(fixture.root, 'fixtures/scenes.json'), sceneBytes);
  for (const entry of document.registry.systems) entry.sceneManifestSha256 = sha256(sceneBytes);
  document.records.sceneManifestSha256 = sha256(sceneBytes);
  const protocol = JSON.parse(readFileSync(path.join(
    process.cwd(), 'fixtures/paired-theme/v2/material.protocol.json',
  ), 'utf8')) as Record<string, any>;
  const protocolBytes = `${JSON.stringify(protocol)}\n`;
  const material = document.registry.systems.find((entry: Record<string, unknown>) =>
    entry.id === 'material');
  material.adapterId = protocol.adapterId;
  material.protocolSha256 = sha256(protocolBytes);
  await writeFile(path.join(fixture.root, material.protocolPath), protocolBytes);
  await writeFile(path.join(fixture.root, 'pnpm-lock.yaml'), packageLock(protocol.source.package));
  fixture.document = document;
  contract = await loadChangedV2Spec(fixture, document);
  loaded = await loadV2RegisteredProtocol(contract, 'material', fixture.root);
});

afterAll(async () => rm(fixture.root, {recursive: true, force: true}));

describe('paired-theme v2 contract and dual-arm evaluator', () => {
  it('derives and verifies 60/120 raw plus 10/6/3 and 20/12/6 row counts', () => {
    const replicates = ['launch-a', 'launch-b'].map((replicateId) => replicate(replicateId));
    const result = evaluateV2System(replicates, loaded, contract);

    expect(result.counts).toEqual({
      scenes: 4,
      paintsPerVariant: 15,
      variants: 4,
      replicates: 2,
      rawObservationsPerReplicate: 60,
      rawObservationsAcrossReplicates: 120,
      perArm: {reviewed: 10, color: 10, contrast: 6, rank: 3},
      comparison: {color: 20, contrast: 12, rank: 6},
    });
    expect(result.baseline.rows.color).toHaveLength(10);
    expect(result.candidate.rows.color).toHaveLength(10);
    expect(result.baseline.primary.e).toBeGreaterThan(0);
    expect(result.candidate.primary.e).toBe(0);
    expect(result.comparison.relativeImprovement.value).toBe(1);
    expect(result.system).toBe('material');
    expect(result.protocolSha256).toBe(loaded.protocolSha256);
    expect(result.sceneManifestSha256).toBe(loaded.sceneManifestSha256);
  });

  it('fails before scoring when a required variant or arm is absent', () => {
    const missingVariant = observations().filter((row) => row.variant !== 'm2-candidate');
    expect(() => buildV2ObservationReplicate({
      system: 'material', split: 'development', replicateId: 'missing-variant',
      observations: missingVariant,
    }, contract, loaded)).toThrow(/variant m2-candidate expected 15 observations, received 0/);

    const valid = replicate('forgery-source');
    const withoutCandidate = {...valid, candidateMatrix: undefined};
    expect(() => evaluateV2System([
      withoutCandidate,
      {...withoutCandidate, replicateId: 'missing-arm-2'},
    ] as unknown as Parameters<typeof evaluateV2System>[0], loaded, contract))
      .toThrow(/built from authenticated raw observations/);
  });

  it('rejects inconsistent declared denominators at the pinned spec boundary', async () => {
    const inconsistentRaw = structuredClone(fixture.document);
    inconsistentRaw.evaluationContract.denominators.rawObservationsPerSystemPerReplicate = 59;
    await expect(loadChangedV2Spec(fixture, inconsistentRaw))
      .rejects.toThrow(/rawObservationsPerSystemPerReplicate must equal 60/);

    const wrongRows = structuredClone(fixture.document);
    wrongRows.evaluationContract.denominators.perArm.contrast = 5;
    await expect(loadChangedV2Spec(fixture, wrongRows))
      .rejects.toThrow(/perArm.contrast must equal 6/);
  });

  it('requires the actual frozen replicate count and exact reproduction', () => {
    const first = replicate('first');
    expect(() => evaluateV2System([first], loaded, contract))
      .toThrow(/expected 2, received 1/);

    const changedRows = observations().map((row) =>
      row.variant === 'm2-candidate' && row.paintId === 'surface.title'
        ? {...row, value: '#eeeeee'}
        : row);
    const changed = replicate('changed', changedRows);
    expect(() => evaluateV2System([first, changed], loaded, contract))
      .toThrow(/raw observations do not reproduce replicate 1 exactly/);
  });

  it('requires runtime validation and spec-owned system membership', () => {
    expect(() => buildV2ObservationReplicate({
      system: 'not-registered', split: 'development', replicateId: 'unknown',
      observations: observations('not-registered'),
    }, contract, loaded)).toThrow(/absent from the frozen v2 registry/);
    expect(() => evaluateV2System([], loaded,
      {} as unknown as Parameters<typeof evaluateV2System>[2]))
      .toThrow(/loaded from pinned metric-spec bytes/);
    expect(() => evaluateV2Arm({} as never, SCENES,
      {} as unknown as Parameters<typeof evaluateV2Arm>[2]))
      .toThrow(/loaded from pinned metric-spec bytes/);
  });

  it('deep-freezes branded replicates and rejects structurally forged copies', () => {
    const first = replicate('immutable-one');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.candidateMatrix.variants['baseline-candidate'][0])).toBe(true);
    expect(() => {
      (first.candidateMatrix.variants['baseline-candidate'][0]!.observation as {value: string})
        .value = '#ffffff';
    }).toThrow(TypeError);
    const forged = {...first};
    expect(() => evaluateV2System([
      forged, {...forged, replicateId: 'immutable-two'},
    ] as unknown as Parameters<typeof evaluateV2System>[0], loaded, contract))
      .toThrow(/built from authenticated raw observations/);
  });

  it('uses the A8 scene-qualified identity only in the v2 registry reducer', () => {
    const systems = new Set(['test-family']);
    expect(aggregateDecisionLossesForRegistry([
      {system: 'test-family', sceneId: 'one', role: 'text', decisionId: 'paint', loss: 0},
      {system: 'test-family', sceneId: 'two', role: 'text', decisionId: 'paint', loss: 1},
    ], systems)).toEqual([{system: 'test-family', loss: 0.5}]);
    expect(() => aggregateDecisionLossesForRegistry([
      {system: 'test-family', sceneId: 'one', role: 'text', decisionId: 'paint', loss: 0},
      {system: 'test-family', sceneId: 'one', role: 'surface', decisionId: 'paint', loss: 1},
    ], systems)).toThrow(/duplicate/);
    expect(aggregateRankLossesForRegistry([
      {system: 'test-family', sceneId: 'one', pairId: 'rank', loss: 0},
      {system: 'test-family', sceneId: 'two', pairId: 'rank', loss: 1},
    ], systems)).toEqual([{system: 'test-family', loss: 0.5}]);
  });

  it('never applies the D/C/R non-regression tolerance to F worsening', async () => {
    const changed = structuredClone(fixture.document);
    changed.evaluationContract.componentNonRegressionTolerance = 1;
    changed.tuning.objective.componentNonRegressionTolerance = 1;
    const tolerantContract = await loadChangedV2Spec(fixture, changed);
    const tolerantProtocol = await loadV2RegisteredProtocol(
      tolerantContract, 'material', fixture.root,
    );
    const rows = observations().map((row) => {
      if (row.paintId === 'surface.raised' && row.variant === 'm2-candidate') {
        return {...row, value: '#383838'};
      }
      if (row.paintId === 'surface.title' && row.variant === 'baseline-candidate') {
        return {...row, value: '#606060'};
      }
      if (row.paintId === 'surface.title' && row.variant === 'm2-candidate') {
        return {...row, value: '#5f5f5f'};
      }
      return row;
    });
    const replicates = ['strict-f-one', 'strict-f-two'].map((replicateId) =>
      replicate(replicateId, rows, tolerantContract, tolerantProtocol));
    const result = evaluateV2System(replicates, tolerantProtocol, tolerantContract);
    expect(result.comparison.findingDeltas.find((finding) =>
      finding.id.includes('surface.title/text-contrast'))?.status).toBe('worsened');
  });

  it('leaves the v1 reducer closed to its historical five-system registry', () => {
    expect(() => aggregateDecisionLosses([{
      system: 'test-family', sceneId: 'scene', role: 'text', decisionId: 'paint', loss: 0,
    }] as unknown as Parameters<typeof aggregateDecisionLosses>[0]))
      .toThrow(/not a supported design system/);
  });
});

function replicate(
  replicateId: string,
  rows = observations(),
  evaluationContract = contract,
  protocol = loaded,
) {
  return buildV2ObservationReplicate({
    system: 'material', split: 'development', replicateId, observations: rows,
  }, evaluationContract, protocol);
}

function observations(system = 'material'): V2PaintObservation[] {
  return ['light', 'authored-dark', 'baseline-candidate', 'm2-candidate'].flatMap((variant) =>
    SCENES.flatMap((scene) => scene.paints.map((paint) => ({
      schema: 'semantic-dark.paint-observation.v2' as const,
      system,
      split: 'development' as const,
      variant,
      sceneId: scene.id,
      paintId: paint.id,
      component: paint.component,
      state: paint.state,
      property: paint.property,
      pseudo: paint.pseudo,
      role: paint.role,
      backdropPaintId: paint.backdropPaintId,
      contrastKind: paint.contrastKind,
      reviewed: paint.reviewed,
      value: colorFor(variant, paint),
      opacity: '1',
      display: 'block',
      visibility: 'visible',
      rect: {x: 0, y: 0, width: 40, height: 20},
    }))),
  );
}

function colorFor(variant: string, paint: PaintDecision): string {
  if (variant === 'm2-candidate' || variant === 'authored-dark') {
    return ({
      canvas: '#101010', surface: '#202020', surfaceRaised: '#303030',
      tableHeader: '#202020', selectedSurface: '#70a0ff', textPrimary: '#f5f5f5',
      textSecondary: '#cccccc', border: '#a0a0a0', focus: '#80b0ff',
      dangerSurface: '#401818', dangerText: '#ffdddd',
    } as const)[paint.token];
  }
  if (variant === 'baseline-candidate') {
    return ({
      canvas: '#181818', surface: '#292929', surfaceRaised: '#383838',
      tableHeader: '#292929', selectedSurface: '#506080', textPrimary: '#d0d0d0',
      textSecondary: '#aaaaaa', border: '#707070', focus: '#607090',
      dangerSurface: '#352020', dangerText: '#ddbbbb',
    } as const)[paint.token];
  }
  return paint.role === 'text' ? '#111111' : paint.role === 'background' ? '#ffffff' : '#eeeeee';
}

function packageLock(pin: {name: string; version: string; integrity: string}): string {
  return `lockfileVersion: '9.0'\n\npackages:\n\n  '${pin.name}@${pin.version}':\n` +
    `    resolution: {integrity: ${pin.integrity}}\n\nsnapshots:\n`;
}
