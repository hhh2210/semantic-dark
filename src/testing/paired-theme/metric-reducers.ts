import type {ColorRole} from '../../color';
import type {PairedThemeSystem} from './types';

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

export function validateUnitLoss(value: number, label: string): number {
  const loss = finite(value, label);
  if (loss < 0 || loss > 1) throw new RangeError(`${label} must be in [0, 1]`);
  return loss;
}

function decisionRecord(value: DecisionLossRecord, index: number): DecisionLossRecord {
  record(value, `decision loss record ${index}`);
  return {
    system: system(value.system, `decision loss record ${index}.system`),
    sceneId: identifier(value.sceneId, `decision loss record ${index}.sceneId`),
    role: role(value.role, `decision loss record ${index}.role`),
    decisionId: identifier(value.decisionId, `decision loss record ${index}.decisionId`),
    loss: validateUnitLoss(value.loss, `decision loss record ${index}.loss`),
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

function rankLoss(value: number, label: string): 0 | 0.5 | 1 {
  const loss = validateUnitLoss(value, label);
  if (loss !== 0 && loss !== 0.5 && loss !== 1) throw new RangeError(
    `${label} must be 0, 0.5, or 1`,
  );
  return loss;
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

function record(value: object, label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
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
