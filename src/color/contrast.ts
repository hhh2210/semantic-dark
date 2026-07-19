import {compositeSrgb} from './composite';
import {gamutMapOklch, srgbToOklab, srgbToOklch} from './oklab';
import {clipSrgb, quantizeSrgb8, srgbChannelToLinear} from './srgb';
import {srgb, type OklabColor, type OklchColor, type SrgbColor} from './types';

export const WCAG_TEXT_CONTRAST = 4.5;
export const WCAG_NON_TEXT_CONTRAST = 3;

const WHITE = srgb(1, 1, 1);
const SEARCH_ITERATIONS = 40;
const CONTRAST_EPSILON = 1e-7;

export interface ContrastOptions {
  canvas?: SrgbColor;
  direction?: 'auto' | 'lighter' | 'darker';
  allowAlphaIncrease?: boolean;
}

export interface ContrastAdjustment {
  color: SrgbColor;
  ratio: number;
  adjusted: boolean;
  attainable: boolean;
}

export interface Rgba8ContrastRatios {
  analytic: number;
  rendered: number;
  minimum: number;
}

/** WCAG relative luminance for an opaque, gamma-encoded sRGB color. */
export function relativeLuminance(color: SrgbColor): number {
  const clipped = clipSrgb(color);
  return (
    0.2126 * srgbChannelToLinear(clipped.r) +
    0.7152 * srgbChannelToLinear(clipped.g) +
    0.0722 * srgbChannelToLinear(clipped.b)
  );
}

/**
 * WCAG contrast after flattening alpha. The background is first composited over
 * an opaque canvas (white by default), then the foreground over that result.
 */
export function contrastRatio(
  foreground: SrgbColor,
  background: SrgbColor,
  canvas: SrgbColor = WHITE,
): number {
  const opaqueCanvas = {...clipSrgb(canvas), a: 1};
  const flattenedBackground = compositeSrgb(background, opaqueCanvas);
  const flattenedForeground = compositeSrgb(foreground, flattenedBackground);
  const foregroundLuminance = relativeLuminance(flattenedForeground);
  const backgroundLuminance = relativeLuminance(flattenedBackground);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Adjust only OKLCH lightness (and, if unavoidable, opacity) to meet contrast. */
export function ensureContrast(
  foreground: SrgbColor,
  background: SrgbColor,
  minimumRatio: number,
  options: ContrastOptions = {},
): SrgbColor {
  return ensureContrastWithReport(foreground, background, minimumRatio, options).color;
}

export function ensureContrastWithReport(
  foreground: SrgbColor,
  background: SrgbColor,
  minimumRatio: number,
  options: ContrastOptions = {},
): ContrastAdjustment {
  return solveContrast(
    foreground,
    minimumRatio,
    options,
    clipSrgb,
    (candidate) => contrastRatio(candidate, background, options.canvas),
    CONTRAST_EPSILON,
  );
}

/** Solve against Chrome's RGBA8 declaration and final rendered-pixel grids. */
export function ensureRgba8ContrastWithReport(
  foreground: SrgbColor,
  background: SrgbColor,
  minimumRatio: number,
  options: ContrastOptions = {},
): ContrastAdjustment {
  return solveContrast(
    foreground,
    minimumRatio,
    options,
    quantizeSrgb8,
    (candidate) => Math.min(
      contrastRatio(candidate, background, options.canvas),
      rgba8ContrastRatios(candidate, background, options.canvas).minimum,
    ),
    0,
  );
}

/** Compare both the declared RGBA8 colors and the quantized composited pixels. */
export function rgba8ContrastRatios(
  foreground: SrgbColor,
  background: SrgbColor,
  canvas?: SrgbColor,
): Rgba8ContrastRatios {
  const declaredForeground = quantizeSrgb8(foreground);
  const declaredBackground = quantizeSrgb8(background);
  const opaqueCanvas = {...quantizeSrgb8(canvas ?? WHITE), a: 1};
  const analytic = contrastRatio(declaredForeground, declaredBackground, opaqueCanvas);
  const renderedBackground = quantizeSrgb8(compositeSrgb(declaredBackground, opaqueCanvas));
  const renderedForeground = quantizeSrgb8(
    compositeSrgb(declaredForeground, renderedBackground),
  );
  const rendered = contrastRatio(renderedForeground, renderedBackground, opaqueCanvas);
  return {analytic, rendered, minimum: Math.min(analytic, rendered)};
}

function solveContrast(
  foreground: SrgbColor,
  minimumRatio: number,
  options: ContrastOptions,
  project: (color: SrgbColor) => SrgbColor,
  ratioOf: (color: SrgbColor) => number,
  epsilon: number,
): ContrastAdjustment {
  const initial = clipSrgb(foreground);
  const target = Math.max(1, minimumRatio);
  const projectedInitial = project(initial);
  const initialRatio = ratioOf(projectedInitial);
  if (passes(initialRatio, target, epsilon)) {
    return {
      color: projectedInitial,
      ratio: initialRatio,
      adjusted: colorDistance(initial, projectedInitial) > 1e-9 ||
        Math.abs(initial.a - projectedInitial.a) > 1e-9,
      attainable: true,
    };
  }

  const source = srgbToOklch(initial);
  const direction = options.direction ?? 'auto';
  const atOriginalAlpha = findClosestLightness(
    source, target, direction, project, ratioOf, epsilon,
  );
  if (atOriginalAlpha) return adjustment(initial, atOriginalAlpha, target, ratioOf, epsilon);

  if (options.allowAlphaIncrease !== false && source.alpha < 1) {
    const opaque = findClosestLightness(
      {...source, alpha: 1},
      target,
      direction,
      project,
      ratioOf,
      epsilon,
    );
    if (opaque) return adjustment(initial, opaque, target, ratioOf, epsilon);
  }

  const fallback = bestEndpoint(
    {...source, alpha: options.allowAlphaIncrease === false ? source.alpha : 1},
    direction,
    project,
    ratioOf,
  );
  const ratio = ratioOf(fallback);
  return {color: fallback, ratio, adjusted: true, attainable: passes(ratio, target, epsilon)};
}

function adjustment(
  initial: SrgbColor,
  color: SrgbColor,
  target: number,
  ratioOf: (color: SrgbColor) => number,
  epsilon: number,
): ContrastAdjustment {
  const ratio = ratioOf(color);
  return {
    color,
    ratio,
    adjusted: colorDistance(initial, color) > 1e-9 || Math.abs(initial.a - color.a) > 1e-9,
    attainable: passes(ratio, target, epsilon),
  };
}

function findClosestLightness(
  source: OklchColor,
  target: number,
  direction: NonNullable<ContrastOptions['direction']>,
  project: (color: SrgbColor) => SrgbColor,
  ratioOf: (color: SrgbColor) => number,
  epsilon: number,
): SrgbColor | null {
  const candidates: SrgbColor[] = [];
  if (direction !== 'darker') {
    const lighter = searchLightness(source, target, 1, project, ratioOf, epsilon);
    if (lighter) candidates.push(lighter);
  }
  if (direction !== 'lighter') {
    const darker = searchLightness(source, target, 0, project, ratioOf, epsilon);
    if (darker) candidates.push(darker);
  }
  if (candidates.length === 0) return null;

  const sourceLab = srgbToOklab(gamutMapOklch(source));
  return candidates.reduce((best, candidate) =>
    oklabDistance(sourceLab, srgbToOklab(candidate)) < oklabDistance(sourceLab, srgbToOklab(best))
      ? candidate
      : best,
  );
}

function searchLightness(
  source: OklchColor,
  target: number,
  endpoint: 0 | 1,
  project: (color: SrgbColor) => SrgbColor,
  ratioOf: (color: SrgbColor) => number,
  epsilon: number,
): SrgbColor | null {
  let failing = source.l;
  let passing: number = endpoint;
  let passingColor = project(gamutMapOklch({...source, l: endpoint}));
  if (!passes(ratioOf(passingColor), target, epsilon)) return null;

  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration += 1) {
    const midpoint = (failing + passing) / 2;
    const candidate = project(gamutMapOklch({...source, l: midpoint}));
    if (passes(ratioOf(candidate), target, epsilon)) {
      passing = midpoint;
      passingColor = candidate;
    } else {
      failing = midpoint;
    }
  }
  return passingColor;
}

function bestEndpoint(
  source: OklchColor,
  direction: NonNullable<ContrastOptions['direction']>,
  project: (color: SrgbColor) => SrgbColor,
  ratioOf: (color: SrgbColor) => number,
): SrgbColor {
  const candidates: SrgbColor[] = [];
  if (direction !== 'darker') candidates.push(project(gamutMapOklch({...source, l: 1})));
  if (direction !== 'lighter') candidates.push(project(gamutMapOklch({...source, l: 0})));
  return candidates.reduce((best, candidate) =>
    ratioOf(candidate) > ratioOf(best)
      ? candidate
      : best,
  );
}

function passes(ratio: number, target: number, epsilon: number): boolean {
  return ratio + epsilon >= target;
}

function colorDistance(left: SrgbColor, right: SrgbColor): number {
  return oklabDistance(srgbToOklab(left), srgbToOklab(right));
}

function oklabDistance(left: OklabColor, right: OklabColor): number {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}
