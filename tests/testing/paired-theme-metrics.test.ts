import {describe, expect, it} from 'vitest';

import {srgb} from '../../src/color';
import {
  aggregateDecisionLosses,
  aggregatePairedThemeMetrics,
  aggregateRankLosses,
  colorDistanceLoss,
  composePairScore,
  contrastConsistencyLoss,
  surfaceRankLoss,
  type DecisionLossRecord,
  type RankLossRecord,
} from '../../src/testing/paired-theme/metrics';

describe('paired-theme metric primitives', () => {
  it('uses the frozen capped OKLab distance formula', () => {
    expect(colorDistanceLoss(srgb(0.5, 0.5, 0.5), srgb(0.5, 0.5, 0.5))).toBe(0);
    expect(colorDistanceLoss(srgb(0, 0, 0), srgb(1, 1, 1))).toBe(1);
  });

  it('uses the frozen capped absolute log2 contrast formula', () => {
    expect(contrastConsistencyLoss(4.5, 4.5)).toBe(0);
    expect(contrastConsistencyLoss(Math.SQRT2, 1)).toBeCloseTo(0.5, 12);
    expect(contrastConsistencyLoss(2, 4)).toBe(1);
    expect(contrastConsistencyLoss(16, 1)).toBe(1);
  });

  it('scores preserved, tied, and inverted surface order', () => {
    const dark = srgb(0.1, 0.1, 0.1);
    const light = srgb(0.8, 0.8, 0.8);
    const nearDark = srgb(0.101, 0.101, 0.101);

    expect(surfaceRankLoss(dark, light, dark, light, 0.01)).toBe(0);
    expect(surfaceRankLoss(dark, nearDark, dark, light, 0.01)).toBe(0.5);
    expect(surfaceRankLoss(light, dark, dark, light, 0.01)).toBe(1);
  });

  it('treats an authored tie as the middle of the frozen ternary relation', () => {
    const tiedLower = srgb(0.4, 0.4, 0.4);
    const tiedUpper = srgb(0.401, 0.401, 0.401);
    const clearlyUpper = srgb(0.8, 0.8, 0.8);

    expect(surfaceRankLoss(
      tiedLower,
      tiedUpper,
      tiedLower,
      tiedUpper,
      0.01,
    )).toBe(0);
    expect(surfaceRankLoss(
      tiedLower,
      clearlyUpper,
      tiedLower,
      tiedUpper,
      0.01,
    )).toBe(0.5);
  });

  it('hard-fails invalid primitive inputs', () => {
    expect(() => colorDistanceLoss({...srgb(0, 0, 0), r: Number.NaN}, srgb(0, 0, 0)))
      .toThrow(/finite/);
    expect(() => colorDistanceLoss(srgb(0, 0, 0, 0.5), srgb(0, 0, 0)))
      .toThrow(/opaque/);
    expect(() => contrastConsistencyLoss(0.5, 4.5)).toThrow(/at least 1/);
    expect(() => contrastConsistencyLoss(Number.NaN, 4.5)).toThrow(/finite/);
    expect(() => surfaceRankLoss(
      srgb(0, 0, 0),
      srgb(1, 1, 1),
      srgb(0.5, 0.5, 0.5),
      srgb(0.501, 0.501, 0.501),
      0,
    )).toThrow(/tie epsilon/);
  });
});

describe('paired-theme hierarchical aggregation', () => {
  const decisionRows: DecisionLossRecord[] = [
    {system: 'material', role: 'text', sceneId: 'a', decisionId: 'a1', loss: 0},
    {system: 'material', role: 'text', sceneId: 'a', decisionId: 'a2', loss: 0},
    {system: 'material', role: 'text', sceneId: 'a', decisionId: 'a3', loss: 1},
    {system: 'material', role: 'text', sceneId: 'b', decisionId: 'b1', loss: 1},
    {system: 'material', role: 'surface', sceneId: 'c', decisionId: 'c1', loss: 0.2},
    {system: 'material', role: 'surface', sceneId: 'c', decisionId: 'c2', loss: 0.4},
  ];

  const rankRows: RankLossRecord[] = [
    {system: 'material', sceneId: 'a', pairId: 'a1', loss: 0},
    {system: 'material', sceneId: 'a', pairId: 'a2', loss: 1},
    {system: 'material', sceneId: 'b', pairId: 'b1', loss: 0},
  ];

  it('reduces decision median, scene mean, role mean, then system mean', () => {
    expect(aggregateDecisionLosses(decisionRows)).toEqual([
      {system: 'material', loss: 0.4},
    ]);
  });

  it('reduces pair mean, scene mean, then system mean', () => {
    expect(aggregateRankLosses(rankRows)).toEqual([
      {system: 'material', loss: 0.25},
    ]);
  });

  it('is independent of input order', () => {
    expect(aggregateDecisionLosses([...decisionRows].reverse()))
      .toEqual(aggregateDecisionLosses(decisionRows));
    expect(aggregateRankLosses([...rankRows].reverse()))
      .toEqual(aggregateRankLosses(rankRows));
  });

  it('uses an equal-weight composite with no runtime weight surface', () => {
    expect(composePairScore(0.3, 0.6, 0.9)).toEqual({
      e: 0.6,
      pairScore: 40,
    });
  });

  it('returns separate, sorted design-system scores instead of pooling rows', () => {
    const color: DecisionLossRecord[] = [
      {system: 'primer', role: 'text', sceneId: 'p', decisionId: 'p', loss: 0},
      {system: 'material', role: 'text', sceneId: 'm', decisionId: 'm', loss: 0.25},
    ];
    const contrast: DecisionLossRecord[] = [
      {system: 'material', role: 'text', sceneId: 'm', decisionId: 'm', loss: 0.5},
      {system: 'primer', role: 'text', sceneId: 'p', decisionId: 'p', loss: 0},
    ];
    const rank: RankLossRecord[] = [
      {system: 'primer', sceneId: 'p', pairId: 'p', loss: 0},
      {system: 'material', sceneId: 'm', pairId: 'm1', loss: 0.5},
      {system: 'material', sceneId: 'm', pairId: 'm2', loss: 1},
    ];

    expect(aggregatePairedThemeMetrics({color, contrast, rank})).toEqual([
      {system: 'material', d: 0.25, c: 0.5, r: 0.75, e: 0.5, pairScore: 50},
      {system: 'primer', d: 0, c: 0, r: 0, e: 0, pairScore: 100},
    ]);
  });

  it('hard-fails invalid, duplicate, empty, and missing component records', () => {
    expect(() => aggregateDecisionLosses([
      {...decisionRows[0]!, loss: Number.NaN},
    ])).toThrow(/finite/);
    expect(() => aggregateDecisionLosses([decisionRows[0]!, decisionRows[0]!]))
      .toThrow(/duplicate/);
    expect(() => aggregateDecisionLosses([
      decisionRows[0]!,
      {...decisionRows[0]!, role: 'surface', sceneId: 'other'},
    ])).toThrow(/duplicate/);
    expect(() => aggregateRankLosses([])).toThrow(/non-empty/);
    expect(() => aggregateRankLosses([{...rankRows[0]!, loss: 0.25}]))
      .toThrow(/0, 0.5, or 1/);
    expect(() => aggregateRankLosses([
      rankRows[0]!,
      {...rankRows[0]!, sceneId: 'other'},
    ])).toThrow(/duplicate/);
    expect(() => aggregatePairedThemeMetrics({
      color: [decisionRows[0]!],
      contrast: [{...decisionRows[0]!, system: 'primer'}],
      rank: [rankRows[0]!],
    })).toThrow(/missing contrast component for material/);
    expect(() => aggregatePairedThemeMetrics({
      color: [decisionRows[0]!],
      contrast: undefined,
      rank: [rankRows[0]!],
    } as unknown as Parameters<typeof aggregatePairedThemeMetrics>[0])).toThrow(/non-empty/);
  });
});
