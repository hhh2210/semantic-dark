import {srgbToOklab, type ColorRole, type SrgbColor} from '../../color';
import type {PairedThemeSystem} from './types';

export const PAIRED_THEME_COLOR_DISTANCE_CAP = 0.1;
export const PAIRED_THEME_CONTRAST_LOG2_CAP = 1;
export const PAIRED_THEME_COMPONENT_WEIGHT = 1 / 3;

const SYSTEMS = new Set<PairedThemeSystem>(
  ['material', 'primer', 'spectrum', 'carbon', 'fluent'],
);
const ROLES = new Set<ColorRole>(
  ['background', 'surface', 'text', 'border', 'accent', 'svgFill', 'svgStroke'],
);

export interface DecisionLossRecord {
  system: PairedThemeSystem;
  sceneId: string;
  role: ColorRole;
  decisionId: string;
  loss: number;
}

export interface RankLossRecord {
  system: PairedThemeSystem;
  sceneId: string;
  pairId: string;
  loss: number;
}

export interface SystemComponentLoss {system: PairedThemeSystem; loss: number}

export interface PairedThemeMetricInput {
  color: readonly DecisionLossRecord[];
  contrast: readonly DecisionLossRecord[];
  rank: readonly RankLossRecord[];
}

export interface PairedThemeSystemScore {
  system: PairedThemeSystem;
  d: number;
  c: number;
  r: number;
  e: number;
  pairScore: number;
}

/** Fixed, capped OKLab Euclidean loss for an effective rendered paint. */
export function colorDistanceLoss(candidate: SrgbColor, authoredDark: SrgbColor): number {
  const candidateLab = srgbToOklab(effectiveColor(candidate, 'candidate'));
  const authoredLab = srgbToOklab(effectiveColor(authoredDark, 'authored dark'));
  const distance = Math.hypot(candidateLab.l - authoredLab.l,
    candidateLab.a - authoredLab.a, candidateLab.b - authoredLab.b);
  return Math.min(distance / PAIRED_THEME_COLOR_DISTANCE_CAP, 1);
}

/** Fixed, capped absolute log2 error between candidate and authored contrast. */
export function contrastConsistencyLoss(
  candidateContrast: number,
  authoredContrast: number,
): number {
  const candidate = contrastRatio(candidateContrast, 'candidate contrast');
  const authored = contrastRatio(authoredContrast, 'authored contrast');
  return Math.min(Math.abs(Math.log2(candidate / authored)), PAIRED_THEME_CONTRAST_LOG2_CAP);
}

/**
 * Compare a candidate surface relation with the authored dark relation.
 * Relations are ternary (-1, 0, +1) under the frozen epsilon. The loss is half
 * their ordinal distance: exact agreement is 0, crossing one tie boundary is
 * 0.5, and a full inversion is 1.
 */
export function surfaceRankLoss(
  candidateLower: SrgbColor,
  candidateUpper: SrgbColor,
  authoredLower: SrgbColor,
  authoredUpper: SrgbColor,
  tieEpsilon: number,
): 0 | 0.5 | 1 {
  const epsilon = finite(tieEpsilon, 'rank tie epsilon');
  if (epsilon <= 0 || epsilon > 1) throw new RangeError('rank tie epsilon must be in (0, 1]');

  const candidateDelta = lightness(candidateUpper, 'candidate upper') -
    lightness(candidateLower, 'candidate lower');
  const authoredDelta = lightness(authoredUpper, 'authored upper') -
    lightness(authoredLower, 'authored lower');
  const authoredRelation = relation(authoredDelta, epsilon);
  const candidateRelation = relation(candidateDelta, epsilon);
  return (Math.abs(candidateRelation - authoredRelation) / 2) as 0 | 0.5 | 1;
}

/** Median decisions -> mean scenes -> mean roles -> one value per system. */
export function aggregateDecisionLosses(
  records: readonly DecisionLossRecord[],
): SystemComponentLoss[] {
  nonEmptyArray(records, 'decision loss records');

  const normalized = records.map((record, index) => decisionRecord(record, index));
  normalized.sort((left, right) => compareKeys(
    [left.system, left.role, left.sceneId, left.decisionId],
    [right.system, right.role, right.sceneId, right.decisionId],
  ));

  const duplicateKeys = new Set<string>();
  const systems = new Map<PairedThemeSystem, Map<ColorRole, Map<string, number[]>>>();
  for (const record of normalized) {
    const uniqueKey = JSON.stringify([record.system, record.decisionId]);
    if (duplicateKeys.has(uniqueKey)) throw new Error(
      `duplicate decision loss record: ${record.decisionId}`,
    );
    duplicateKeys.add(uniqueKey);

    const roles = getOrCreate(systems, record.system, () => new Map());
    const scenes = getOrCreate(roles, record.role, () => new Map());
    getOrCreate(scenes, record.sceneId, (): number[] => []).push(record.loss);
  }

  return sortedEntries(systems).map(([system, roles]) => {
    const roleLosses = sortedEntries(roles).map(([, scenes]) => {
      const sceneLosses = sortedEntries(scenes).map(([, losses]) => median(losses));
      return mean(sceneLosses);
    });
    return {system, loss: mean(roleLosses)};
  });
}

/** Mean ordered pairs -> mean scenes -> one value per system. */
export function aggregateRankLosses(records: readonly RankLossRecord[]): SystemComponentLoss[] {
  nonEmptyArray(records, 'rank loss records');

  const normalized = records.map((record, index) => rankRecord(record, index));
  normalized.sort((left, right) => compareKeys(
    [left.system, left.sceneId, left.pairId],
    [right.system, right.sceneId, right.pairId],
  ));

  const duplicateKeys = new Set<string>();
  const systems = new Map<PairedThemeSystem, Map<string, number[]>>();
  for (const record of normalized) {
    const uniqueKey = JSON.stringify([record.system, record.pairId]);
    if (duplicateKeys.has(uniqueKey)) throw new Error(`duplicate rank loss record: ${record.pairId}`);
    duplicateKeys.add(uniqueKey);
    const scenes = getOrCreate(systems, record.system, () => new Map());
    getOrCreate(scenes, record.sceneId, (): number[] => []).push(record.loss);
  }

  return sortedEntries(systems).map(([system, scenes]) => ({
    system,
    loss: mean(sortedEntries(scenes).map(([, losses]) => mean(losses))),
  }));
}

/** Equal-weight composite; weights are deliberately not a runtime option. */
export function composePairScore(
  dValue: number, cValue: number, rValue: number,
): Omit<PairedThemeSystemScore, 'system' | 'd' | 'c' | 'r'> {
  const d = unitLoss(dValue, 'D');
  const c = unitLoss(cValue, 'C');
  const r = unitLoss(rValue, 'R');
  const e = PAIRED_THEME_COMPONENT_WEIGHT * d + PAIRED_THEME_COMPONENT_WEIGHT * c +
    PAIRED_THEME_COMPONENT_WEIGHT * r;
  return {e, pairScore: 100 * (1 - e)};
}

/** Aggregate each component separately and refuse any cross-system omission. */
export function aggregatePairedThemeMetrics(input: PairedThemeMetricInput): PairedThemeSystemScore[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(
    'paired-theme metric input must be an object',
  );
  const color = componentMap(aggregateDecisionLosses(input.color), 'color');
  const contrast = componentMap(aggregateDecisionLosses(input.contrast), 'contrast');
  const rank = componentMap(aggregateRankLosses(input.rank), 'rank');
  const systems = [...new Set([...color.keys(), ...contrast.keys(), ...rank.keys()])].sort(compare);

  return systems.map((system) => {
    const d = requiredComponent(color, system, 'color');
    const c = requiredComponent(contrast, system, 'contrast');
    const r = requiredComponent(rank, system, 'rank');
    return {system, d, c, r, ...composePairScore(d, c, r)};
  });
}

function decisionRecord(value: DecisionLossRecord, index: number): DecisionLossRecord {
  record(value, `decision loss record ${index}`);
  return {
    system: system(value.system, `decision loss record ${index}.system`),
    sceneId: identifier(value.sceneId, `decision loss record ${index}.sceneId`),
    role: role(value.role, `decision loss record ${index}.role`),
    decisionId: identifier(value.decisionId, `decision loss record ${index}.decisionId`),
    loss: unitLoss(value.loss, `decision loss record ${index}.loss`),
  };
}

function rankRecord(value: RankLossRecord, index: number): RankLossRecord {
  record(value, `rank loss record ${index}`);
  return {
    system: system(value.system, `rank loss record ${index}.system`),
    sceneId: identifier(value.sceneId, `rank loss record ${index}.sceneId`),
    pairId: identifier(value.pairId, `rank loss record ${index}.pairId`),
    loss: rankLoss(value.loss, `rank loss record ${index}.loss`),
  };
}

function effectiveColor(value: SrgbColor, label: string): SrgbColor {
  record(value, label, 'sRGB color');
  const color = {
    r: channel(value.r, `${label}.r`),
    g: channel(value.g, `${label}.g`),
    b: channel(value.b, `${label}.b`),
    a: channel(value.a, `${label}.a`),
  };
  if (Math.abs(color.a - 1) > 1e-12) throw new Error(
    `${label} must be opaque after backdrop compositing`,
  );
  return color;
}

function lightness(value: SrgbColor, label: string): number {
  return srgbToOklab(effectiveColor(value, label)).l;
}

function relation(delta: number, epsilon: number): -1 | 0 | 1 {
  if (delta < -epsilon) return -1;
  if (delta > epsilon) return 1;
  return 0;
}

function contrastRatio(value: number, label: string): number {
  const ratio = finite(value, label);
  if (ratio < 1) throw new RangeError(`${label} must be at least 1`);
  return ratio;
}

function unitLoss(value: number, label: string): number {
  const loss = finite(value, label);
  if (loss < 0 || loss > 1) throw new RangeError(`${label} must be in [0, 1]`);
  return loss;
}

function rankLoss(value: number, label: string): 0 | 0.5 | 1 {
  const loss = unitLoss(value, label);
  if (loss !== 0 && loss !== 0.5 && loss !== 1) throw new RangeError(
    `${label} must be 0, 0.5, or 1`,
  );
  return loss;
}

function channel(value: number, label: string): number {
  const result = finite(value, label);
  if (result < 0 || result > 1) throw new RangeError(`${label} must be in [0, 1]`);
  return result;
}

function finite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(
    `${label} must be finite`,
  );
  return value;
}

function identifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(
    `${label} must be a non-empty string`,
  );
  return value;
}

function system(value: PairedThemeSystem, label: string): PairedThemeSystem {
  if (!SYSTEMS.has(value)) throw new TypeError(`${label} is not a supported design system`);
  return value;
}

function role(value: ColorRole, label: string): ColorRole {
  if (!ROLES.has(value)) throw new TypeError(`${label} is not a supported color role`);
  return value;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot take the median of an empty cell');
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[midpoint]!;
  return (ordered[midpoint - 1]! + ordered[midpoint]!) / 2;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot take the mean of an empty cell');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nonEmptyArray(value: readonly unknown[], label: string): void {
  if (!Array.isArray(value) || value.length === 0) throw new Error(
    `${label} must be a non-empty array`,
  );
}

function record(value: object, label: string, kind = 'object'): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ${kind}`);
  }
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

function sortedEntries<K extends string, V>(map: ReadonlyMap<K, V>): [K, V][] {
  return [...map.entries()].sort(([left], [right]) => compare(left, right));
}

function compareKeys(left: readonly string[], right: readonly string[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const result = compare(left[index]!, right[index]!);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentMap(values: readonly SystemComponentLoss[], label: string): Map<PairedThemeSystem, number> {
  const result = new Map<PairedThemeSystem, number>();
  for (const value of values) {
    if (result.has(value.system)) throw new Error(`duplicate ${label} result for ${value.system}`);
    result.set(value.system, unitLoss(value.loss, `${label} loss for ${value.system}`));
  }
  return result;
}

function requiredComponent(values: ReadonlyMap<PairedThemeSystem, number>,
  system: PairedThemeSystem, label: string): number {
  const value = values.get(system);
  if (value === undefined) throw new Error(`missing ${label} component for ${system}`);
  return value;
}
