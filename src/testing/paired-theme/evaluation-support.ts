import {
  hueDistanceDegrees,
  srgbToOklab,
  srgbToOklch,
  type ColorRole,
  type SrgbColor,
} from '../../color';
import type {DecisionLossRecord, RankLossRecord} from './metrics';
import type {EffectivePaintObservation, PairedThemeObservationMatrix} from './observations';
import type {
  AutomaticFinding,
  ColorMetricRow,
  ContrastMetricRow,
  PairedThemeSystemEvaluation,
  RankMetricRow,
} from './evaluation-types';
import type {SceneDefinition} from './types';

export function secondary(
  contrastRows: readonly ContrastMetricRow[],
  rankRows: readonly RankMetricRow[],
  findings: readonly AutomaticFinding[],
  accent: ReturnType<typeof accentHueSummary>,
): PairedThemeSystemEvaluation['secondary'] {
  const inversions = rankRows.filter((row) => row.inversion).length;
  const ties = rankRows.filter((row) => row.tieMismatch).length;
  return {
    contrastErrorRaw: aggregateRawContrast(contrastRows),
    surfaceRankInversionRate: inversions / rankRows.length,
    surfaceRankTieMismatchCount: ties,
    surfaceRankTieMismatchRate: ties / rankRows.length,
    ...accent,
    hardFailureCount: findings.length,
    textContrastFailures: findings.filter((row) => row.rule === 'text-contrast').length,
    nonTextContrastFailures: findings.filter((row) => row.rule === 'non-text-contrast').length,
    surfaceSeparationFailures: findings.filter((row) => row.rule === 'surface-separation').length,
    surfaceRankReversals: findings.filter((row) => row.rule === 'surface-rank-reversal').length,
    abstentions: 0,
  };
}

export function accentHueSummary(
  colorRows: readonly ColorMetricRow[],
  candidate: ReadonlyMap<string, EffectivePaintObservation>,
  authored: ReadonlyMap<string, EffectivePaintObservation>,
  threshold: number,
): Pick<PairedThemeSystemEvaluation['secondary'],
  'accentHueErrorDegrees' | 'accentHueEligible' | 'accentHueLowChromaCandidates'> {
  const errors: number[] = [];
  let lowChromaCandidates = 0;
  for (const row of colorRows.filter((item) => item.role === 'accent')) {
    const authoredLch = srgbToOklch(required(authored, row.decisionId, 'authored accent').effectiveColor);
    if (authoredLch.c < threshold) continue;
    const candidateLch = srgbToOklch(required(candidate, row.decisionId, 'candidate accent').effectiveColor);
    if (candidateLch.c < threshold) {
      lowChromaCandidates += 1;
      errors.push(180);
    } else {
      errors.push(hueDistanceDegrees(candidateLch.h, authoredLch.h));
    }
  }
  return {
    accentHueErrorDegrees: errors.length === 0 ? null : median(errors),
    accentHueEligible: errors.length,
    accentHueLowChromaCandidates: lowChromaCandidates,
  };
}

function aggregateRawContrast(rows: readonly ContrastMetricRow[]): number {
  const roles = new Map<ColorRole, Map<string, number[]>>();
  for (const row of rows) {
    const scenes = getOrCreate(roles, row.role, () => new Map());
    getOrCreate(scenes, row.sceneId, () => []).push(row.absoluteLog2Error);
  }
  return mean([...roles.values()].map((scenes) =>
    mean([...scenes.values()].map(median)),
  ));
}

export function denominators(
  scenes: readonly SceneDefinition[],
  matrix: PairedThemeObservationMatrix,
  colorRows: readonly ColorMetricRow[],
  contrastRows: readonly ContrastMetricRow[],
  rankRows: readonly RankMetricRow[],
): PairedThemeSystemEvaluation['counts'] {
  const paintsPerVariant = scenes.reduce((sum, scene) => sum + scene.paints.length, 0);
  return {
    scenes: scenes.length,
    paintsPerVariant,
    observations: Object.values(matrix.variants).reduce((sum, rows) => sum + rows.length, 0),
    reviewedDecisions: colorRows.length,
    colorRows: colorRows.length,
    contrastRows: contrastRows.length,
    rankPairs: rankRows.length,
    colorByRole: countRoles(colorRows),
    contrastByRole: countRoles(contrastRows),
  };
}

function countRoles(rows: readonly {role: ColorRole}[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.role] = (counts[row.role] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compare(a, b)));
}

export function decisionLoss(row: ColorMetricRow | ContrastMetricRow): DecisionLossRecord {
  return {system: row.system, sceneId: row.sceneId, role: row.role,
    decisionId: row.decisionId, loss: row.loss};
}

export function rankLossRecord(row: RankMetricRow): RankLossRecord {
  return {system: row.system, sceneId: row.sceneId, pairId: row.pairId, loss: row.loss};
}

export function contrastFinding(system: string, sceneId: string, targetId: string,
  kind: 'text' | 'non-text', observed: number, threshold: number): AutomaticFinding {
  const rule = kind === 'text' ? 'text-contrast' : 'non-text-contrast';
  return finding(system, sceneId, targetId, rule, observed, threshold,
    `${targetId} contrast ${formatBoundary(observed)} < ${formatBoundary(threshold)} required minimum`);
}

export function rankFinding(system: string, sceneId: string, targetId: string,
  rule: 'surface-separation' | 'surface-rank-reversal', observed: number,
  threshold: number): AutomaticFinding {
  return finding(system, sceneId, targetId, rule, observed, threshold,
    rule === 'surface-separation'
      ? `${targetId} separation ${formatBoundary(observed)} < ${formatBoundary(threshold)} required minimum`
      : `${targetId} reverses the authored dark surface relation`);
}

function formatBoundary(value: number): string {
  return value.toFixed(8);
}

function finding(system: string, sceneId: string, targetId: string,
  rule: AutomaticFinding['rule'], observed: number, threshold: number,
  message: string): AutomaticFinding {
  return {id: `F/${system}/${sceneId}/${targetId}/${rule}`, source: 'automatic', rule,
    severity: 'F', sceneId, targetId, observed, threshold, comparison: 'baseline-open',
    vetoApplicable: false, message};
}

export function required<T>(values: ReadonlyMap<string, T>, id: string, label: string): T {
  const value = values.get(id);
  if (!value) throw new Error(`Missing ${label} paint ${id}`);
  return value;
}

export function oklabDistance(left: SrgbColor, right: SrgbColor): number {
  const a = srgbToOklab(left);
  const b = srgbToOklab(right);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

export function labLightness(color: SrgbColor): number {
  return srgbToOklab(color).l;
}

export function relation(delta: number, epsilon: number): -1 | 0 | 1 {
  return delta < -epsilon ? -1 : delta > epsilon ? 1 : 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot take median of empty values');
  const ordered = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[midpoint]! :
    (ordered[midpoint - 1]! + ordered[midpoint]!) / 2;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot take mean of empty values');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const current = map.get(key);
  if (current !== undefined) return current;
  const value = create();
  map.set(key, value);
  return value;
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
