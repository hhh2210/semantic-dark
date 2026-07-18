import { clipSrgb, isSrgbInGamut, linearToSrgb, srgbToLinear } from './srgb';
import {
  clamp01,
  normalizeHueDegrees,
  type LinearSrgbColor,
  type OklabColor,
  type OklchColor,
  type SrgbColor,
} from './types';

export function linearSrgbToOklab(color: LinearSrgbColor): OklabColor {
  const l = 0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b;
  const m = 0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b;
  const s = 0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
    alpha: color.a,
  };
}

export function oklabToLinearSrgb(color: OklabColor): LinearSrgbColor {
  const lRoot = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mRoot = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const sRoot = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;

  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    a: color.alpha,
  };
}

export function srgbToOklab(color: SrgbColor): OklabColor {
  return linearSrgbToOklab(srgbToLinear(color));
}

export function oklabToSrgbUnclipped(color: OklabColor): SrgbColor {
  return linearToSrgb(oklabToLinearSrgb(color));
}

export function oklabToSrgb(color: OklabColor): SrgbColor {
  return clipSrgb(oklabToSrgbUnclipped(color));
}

export function oklabToOklch(color: OklabColor): OklchColor {
  const c = Math.hypot(color.a, color.b);
  const h = c < 1e-12 ? 0 : normalizeHueDegrees((Math.atan2(color.b, color.a) * 180) / Math.PI);
  return { l: color.l, c, h, alpha: color.alpha };
}

export function oklchToOklab(color: OklchColor): OklabColor {
  const angle = (normalizeHueDegrees(color.h) * Math.PI) / 180;
  return {
    l: color.l,
    a: Math.max(0, color.c) * Math.cos(angle),
    b: Math.max(0, color.c) * Math.sin(angle),
    alpha: color.alpha,
  };
}

export function srgbToOklch(color: SrgbColor): OklchColor {
  return oklabToOklch(srgbToOklab(color));
}

export function oklchToSrgbUnclipped(color: OklchColor): SrgbColor {
  return oklabToSrgbUnclipped(oklchToOklab(color));
}

/**
 * Convert OKLCH to displayable sRGB while retaining lightness and hue. If the
 * color is outside sRGB, chroma is reduced with a binary search.
 */
export function gamutMapOklch(color: OklchColor): SrgbColor {
  const normalized: OklchColor = {
    l: clamp01(color.l),
    c: Math.max(0, color.c),
    h: normalizeHueDegrees(color.h),
    alpha: clamp01(color.alpha),
  };
  const direct = oklchToSrgbUnclipped(normalized);
  // Gamut mapping must use a strict boundary: accepting a slightly negative
  // channel and clipping it afterward rotates hue, especially near neutrals.
  if (isSrgbInGamut(direct, 0)) return clipSrgb(direct);

  let low = 0;
  let high = normalized.c;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpoint = (low + high) / 2;
    const candidate = oklchToSrgbUnclipped({ ...normalized, c: midpoint });
    if (isSrgbInGamut(candidate, 0)) low = midpoint;
    else high = midpoint;
  }
  return clipSrgb(oklchToSrgbUnclipped({ ...normalized, c: low }));
}
