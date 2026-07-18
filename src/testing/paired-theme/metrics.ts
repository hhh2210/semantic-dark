import {srgbToOklab, type SrgbColor} from '../../color';
import {
  aggregateDecisionLosses,
  aggregateRankLosses,
  validateUnitLoss,
  type PairedThemeMetricInput,
  type SystemComponentLoss,
} from './metric-reducers';
import type {PairedThemeSystem} from './types';

export {
  aggregateDecisionLosses,
  aggregateRankLosses,
  type DecisionLossRecord,
  type PairedThemeMetricInput,
  type RankLossRecord,
  type SystemComponentLoss,
} from './metric-reducers';

export const PAIRED_THEME_COLOR_DISTANCE_CAP = 0.1;
export const PAIRED_THEME_CONTRAST_LOG2_CAP = 1;
export const PAIRED_THEME_COMPONENT_WEIGHT = 1 / 3;

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

/** Equal-weight composite; weights are deliberately not a runtime option. */
export function composePairScore(
  dValue: number, cValue: number, rValue: number,
): Omit<PairedThemeSystemScore, 'system' | 'd' | 'c' | 'r'> {
  const d = validateUnitLoss(dValue, 'D');
  const c = validateUnitLoss(cValue, 'C');
  const r = validateUnitLoss(rValue, 'R');
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

function record(value: object, label: string, kind = 'object'): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ${kind}`);
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentMap(values: readonly SystemComponentLoss[], label: string): Map<PairedThemeSystem, number> {
  const result = new Map<PairedThemeSystem, number>();
  for (const value of values) {
    if (result.has(value.system)) throw new Error(`duplicate ${label} result for ${value.system}`);
    result.set(value.system, validateUnitLoss(value.loss, `${label} loss for ${value.system}`));
  }
  return result;
}

function requiredComponent(values: ReadonlyMap<PairedThemeSystem, number>,
  system: PairedThemeSystem, label: string): number {
  const value = values.get(system);
  if (value === undefined) throw new Error(`missing ${label} component for ${system}`);
  return value;
}
