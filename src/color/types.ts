/** Gamma-encoded sRGB channels in the nominal [0, 1] range. */
export interface SrgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Linear-light sRGB channels. */
export interface LinearSrgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface OklabColor {
  l: number;
  a: number;
  b: number;
  alpha: number;
}

/** OKLCH hue is expressed in degrees in [0, 360). */
export interface OklchColor {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function srgb(r: number, g: number, b: number, a = 1): SrgbColor {
  return { r, g, b, a };
}

export function normalizeHueDegrees(hue: number): number {
  const normalized = hue % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function hueDistanceDegrees(left: number, right: number): number {
  const distance = Math.abs(normalizeHueDegrees(left) - normalizeHueDegrees(right));
  return Math.min(distance, 360 - distance);
}
