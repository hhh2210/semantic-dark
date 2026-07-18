import { clipSrgb, linearToSrgb, srgbToLinear } from './srgb';
import { clamp01, type LinearSrgbColor, type SrgbColor } from './types';

function sourceOverChannels<T extends SrgbColor | LinearSrgbColor>(
  foreground: T,
  background: T,
): T {
  const foregroundAlpha = clamp01(foreground.a);
  const backgroundAlpha = clamp01(background.a);
  const outputAlpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
  if (outputAlpha <= Number.EPSILON) {
    return { r: 0, g: 0, b: 0, a: 0 } as T;
  }

  const backgroundWeight = backgroundAlpha * (1 - foregroundAlpha);
  return {
    r: (foreground.r * foregroundAlpha + background.r * backgroundWeight) / outputAlpha,
    g: (foreground.g * foregroundAlpha + background.g * backgroundWeight) / outputAlpha,
    b: (foreground.b * foregroundAlpha + background.b * backgroundWeight) / outputAlpha,
    a: outputAlpha,
  } as T;
}

/** Source-over compositing in gamma-encoded sRGB, matching legacy CSS colors. */
export function compositeSrgb(foreground: SrgbColor, background: SrgbColor): SrgbColor {
  return clipSrgb(sourceOverChannels(foreground, background));
}

/** Source-over compositing in linear-light sRGB. */
export function compositeLinear(
  foreground: LinearSrgbColor,
  background: LinearSrgbColor,
): LinearSrgbColor {
  return sourceOverChannels(foreground, background);
}

/** Physically linear-light compositing with gamma-encoded sRGB input/output. */
export function compositeSrgbLinearLight(
  foreground: SrgbColor,
  background: SrgbColor,
): SrgbColor {
  return clipSrgb(linearToSrgb(compositeLinear(srgbToLinear(foreground), srgbToLinear(background))));
}
