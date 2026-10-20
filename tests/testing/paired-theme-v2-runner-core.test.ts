import {rm} from 'node:fs/promises';
import type {Browser} from 'playwright';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {loadBaselineRoleProfile} from '../../src/testing/paired-theme/profile-fixture';
import type {PaintDecision} from '../../src/testing/paired-theme/types';
import type {V2NormalizedThemePair} from '../../src/testing/paired-theme/v2/exported-theme-source';
import {runV2ResolvedSystem} from '../../src/testing/paired-theme/v2/runner-core';
import type {ValidatedV2EvaluationContract} from '../../src/testing/paired-theme/v2/contract';
import type {V2PaintCollectionInput} from '../../src/testing/paired-theme/v2/collector';
import type {V2PaintObservation} from '../../src/testing/paired-theme/v2/observations';
import type {LoadedV2RegisteredProtocol} from '../../src/testing/paired-theme/v2/protocol';
import {
  loadMaterialV2Protocol,
  makeV2SpecFixture,
  type V2SpecFixture,
} from './helpers/v2-spec-fixture';

let fixture: V2SpecFixture;
let contract: ValidatedV2EvaluationContract;
let loaded: LoadedV2RegisteredProtocol;

beforeAll(async () => {
  fixture = await makeV2SpecFixture();
  ({contract, loaded} = await loadMaterialV2Protocol(fixture));
});
afterAll(async () => rm(fixture.root, {recursive: true, force: true}));

describe('v2 runner core', () => {
  it('uses two fresh browsers and all four frozen variants before dual-arm scoring', async () => {
    const profiles = (await loadBaselineRoleProfile(process.cwd())).profiles;
    const launches: number[] = [];
    const closes: number[] = [];
    const variants: string[] = [];
    const result = await runV2ResolvedSystem({
      contract,
      loaded,
      theme: theme(),
      baselineProfiles: profiles,
      candidateProfiles: profiles,
      chromePath: '/unused/fake-chrome',
    }, {
      launchBrowser: async () => {
        const id = launches.push(launches.length + 1);
        return {version: () => 'Fake Chrome 1', close: async () => { closes.push(id); }} as Browser;
      },
      collect: async (_browser: Browser, input: V2PaintCollectionInput) => {
        variants.push(input.variant);
        return observations(input);
      },
    });

    expect(launches).toEqual([1, 2]);
    expect(closes).toEqual([1, 2]);
    expect(variants).toEqual([...contract.variants.ordered, ...contract.variants.ordered]);
    expect(result.identities).toHaveLength(2);
    expect(result.identities[0]!.observationSha256).toBe(result.identities[1]!.observationSha256);
    expect(result.comparison.counts).toMatchObject({
      variants: 4, replicates: 2, rawObservationsPerReplicate: 60,
      rawObservationsAcrossReplicates: 120,
      perArm: {reviewed: 10, color: 10, contrast: 6, rank: 3},
      comparison: {color: 20, contrast: 12, rank: 6},
    });
    expect(result.comparison.baseline.primary).toEqual(result.comparison.candidate.primary);
    expect(result.comparison.comparison.relativeImprovement.value).toBe(0);
  });
});

function observations(input: V2PaintCollectionInput): V2PaintObservation[] {
  return input.scenes.flatMap((scene) => scene.paints.map((paint) => ({
    schema: 'semantic-dark.paint-observation.v2',
    system: input.system,
    split: input.split,
    variant: input.variant,
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
    value: colorFor(input.variant, paint),
    opacity: '1', display: 'block', visibility: 'visible',
    rect: {x: 0, y: 0, width: 40, height: 20},
  })));
}

function colorFor(variant: string, paint: PaintDecision): string {
  if (variant === 'authored-dark') return ({
    canvas: '#101010', surface: '#202020', surfaceRaised: '#303030',
    tableHeader: '#202020', selectedSurface: '#70a0ff', textPrimary: '#f5f5f5',
    textSecondary: '#cccccc', border: '#a0a0a0', focus: '#80b0ff',
    dangerSurface: '#401818', dangerText: '#ffdddd',
  } as const)[paint.token];
  if (variant === 'baseline-candidate' || variant === 'm2-candidate') return ({
    canvas: '#181818', surface: '#292929', surfaceRaised: '#383838',
    tableHeader: '#292929', selectedSurface: '#506080', textPrimary: '#d0d0d0',
    textSecondary: '#aaaaaa', border: '#707070', focus: '#607090',
    dangerSurface: '#352020', dangerText: '#ddbbbb',
  } as const)[paint.token];
  return paint.role === 'text' ? '#111111' : paint.role === 'background' ? '#ffffff' : '#eeeeee';
}

function theme(): V2NormalizedThemePair {
  const colors = {
    canvas: ['#fff', '#101010'], surface: ['#eee', '#202020'],
    surfaceRaised: ['#ddd', '#303030'], textPrimary: ['#111', '#f5f5f5'],
    textSecondary: ['#555', '#ccc'], tableHeader: ['#ddd', '#202020'],
    selectedSurface: ['#aac', '#70a0ff'], border: ['#777', '#aaa'],
    focus: ['#06f', '#80b0ff'], dangerSurface: ['#fee', '#401818'],
    dangerText: ['#800', '#ffdddd'],
  } as const;
  return {
    system: 'material', split: 'development',
    source: {name: 'synthetic', version: '1', integrity: 'sha512-test', license: 'MIT',
      repository: 'https://example.test'},
    tokens: Object.fromEntries(Object.entries(colors).map(([name, [light, dark]]) => [name, {
      name, light, dark, sourceToken: name, provenance: 'authored-token',
      resolutionPath: {light: [name], dark: [name]},
    }])) as unknown as V2NormalizedThemePair['tokens'],
  };
}
