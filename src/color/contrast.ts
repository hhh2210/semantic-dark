import {compositeSrgb} from './composite';
import {gamutMapOklch, srgbToOklab, srgbToOklch} from './oklab';
import {srgbChannelToLinear} from './srgb';
import {clipSrgb} from './srgb';
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
  const initial = clipSrgb(foreground);
  const target = Math.max(1, minimumRatio);
  const initialRatio = contrastRatio(initial, background, options.canvas);
  if (initialRatio + CONTRAST_EPSILON >= target) {
    return {color: initial, ratio: initialRatio, adjusted: false, attainable: true};
  }

  const source = srgbToOklch(initial);
  const direction = options.direction ?? 'auto';
  const atOriginalAlpha = findClosestLightness(source, background, target, direction, options.canvas);
  if (atOriginalAlpha) return adjustment(initial, atOriginalAlpha, background, target, options.canvas);

  if (options.allowAlphaIncrease !== false && source.alpha < 1) {
    const opaque = findClosestLightness(
      {...source, alpha: 1},
      background,
      target,
      direction,
      options.canvas,
    );
    if (opaque) return adjustment(initial, opaque, background, target, options.canvas);
  }

  const fallback = bestEndpoint(
    {...source, alpha: options.allowAlphaIncrease === false ? source.alpha : 1},
    background,
    direction,
    options.canvas,
  );
  const ratio = contrastRatio(fallback, background, options.canvas);
  return {color: fallback, ratio, adjusted: true, attainable: ratio + CONTRAST_EPSILON >= target};
}

function adjustment(
  initial: SrgbColor,
  color: SrgbColor,
  background: SrgbColor,
  target: number,
  canvas: SrgbColor | undefined,
): ContrastAdjustment {
  const ratio = contrastRatio(color, background, canvas);
  return {
    color,
    ratio,
    adjusted: colorDistance(initial, color) > 1e-9 || Math.abs(initial.a - color.a) > 1e-9,
    attainable: ratio + CONTRAST_EPSILON >= target,
  };
}

function findClosestLightness(
  source: OklchColor,
  background: SrgbColor,
  target: number,
  direction: NonNullable<ContrastOptions['direction']>,
  canvas: SrgbColor | undefined,
): SrgbColor | null {
  const candidates: SrgbColor[] = [];
  if (direction !== 'darker') {
    const lighter = searchLightness(source, background, target, 1, canvas);
    if (lighter) candidates.push(lighter);
  }
  if (direction !== 'lighter') {
    const darker = searchLightness(source, background, target, 0, canvas);
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
  background: SrgbColor,
  target: number,
  endpoint: 0 | 1,
  canvas: SrgbColor | undefined,
): SrgbColor | null {
  let failing = source.l;
  let passing: number = endpoint;
  let passingColor = gamutMapOklch({...source, l: endpoint});
  if (contrastRatio(passingColor, background, canvas) + CONTRAST_EPSILON < target) return null;

  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration += 1) {
    const midpoint = (failing + passing) / 2;
    const candidate = gamutMapOklch({...source, l: midpoint});
    if (contrastRatio(candidate, background, canvas) + CONTRAST_EPSILON >= target) {
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
  background: SrgbColor,
  direction: NonNullable<ContrastOptions['direction']>,
  canvas: SrgbColor | undefined,
): SrgbColor {
  const candidates: SrgbColor[] = [];
  if (direction !== 'darker') candidates.push(gamutMapOklch({...source, l: 1}));
  if (direction !== 'lighter') candidates.push(gamutMapOklch({...source, l: 0}));
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background, canvas) > contrastRatio(best, background, canvas)
      ? candidate
      : best,
  );
}

function colorDistance(left: SrgbColor, right: SrgbColor): number {
  return oklabDistance(srgbToOklab(left), srgbToOklab(right));
}

function oklabDistance(left: OklabColor, right: OklabColor): number {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}
