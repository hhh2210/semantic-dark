import { clamp01, type LinearSrgbColor, type SrgbColor } from './types';

const SRGB_TO_LINEAR_THRESHOLD = 0.04045;
const LINEAR_TO_SRGB_THRESHOLD = 0.0031308;
const UINT8_MAX = 255;

/** Decode one gamma-encoded sRGB channel to linear light. */
export function srgbChannelToLinear(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const magnitude = Math.abs(channel);
  const decoded =
    magnitude <= SRGB_TO_LINEAR_THRESHOLD
      ? magnitude / 12.92
      : ((magnitude + 0.055) / 1.055) ** 2.4;
  return sign * decoded;
}

/** Encode one linear-light channel as gamma-encoded sRGB. */
export function linearChannelToSrgb(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const magnitude = Math.abs(channel);
  const encoded =
    magnitude <= LINEAR_TO_SRGB_THRESHOLD
      ? 12.92 * magnitude
      : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return sign * encoded;
}

export function srgbToLinear(color: SrgbColor): LinearSrgbColor {
  return {
    r: srgbChannelToLinear(color.r),
    g: srgbChannelToLinear(color.g),
    b: srgbChannelToLinear(color.b),
    a: color.a,
  };
}

export function linearToSrgb(color: LinearSrgbColor): SrgbColor {
  return {
    r: linearChannelToSrgb(color.r),
    g: linearChannelToSrgb(color.g),
    b: linearChannelToSrgb(color.b),
    a: color.a,
  };
}

export function clipSrgb(color: SrgbColor): SrgbColor {
  return {
    r: clamp01(color.r),
    g: clamp01(color.g),
    b: clamp01(color.b),
    a: clamp01(color.a),
  };
}

/** Snap declared sRGB channels to the RGBA8 grid used by Chrome paint output. */
export function quantizeSrgb8(color: SrgbColor): SrgbColor {
  const clipped = clipSrgb(color);
  return {
    r: Math.round(clipped.r * UINT8_MAX) / UINT8_MAX,
    g: Math.round(clipped.g * UINT8_MAX) / UINT8_MAX,
    b: Math.round(clipped.b * UINT8_MAX) / UINT8_MAX,
    a: Math.round(clipped.a * UINT8_MAX) / UINT8_MAX,
  };
}

export function isSrgbInGamut(color: SrgbColor, epsilon = 1e-7): boolean {
  return (
    color.r >= -epsilon &&
    color.r <= 1 + epsilon &&
    color.g >= -epsilon &&
    color.g <= 1 + epsilon &&
    color.b >= -epsilon &&
    color.b <= 1 + epsilon
  );
}
