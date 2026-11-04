import {ensureRgba8ContrastWithReport, relativeLuminance, rgba8ContrastRatios} from './contrast';
import {quantizeSrgb8} from './srgb';
import type {SrgbColor} from './types';

/** Repair an already-mapped foreground without inverting it a second time. */
export function textColorForBackdrops(
  foreground: SrgbColor,
  backdrops: readonly SrgbColor[],
  minimum: number,
): SrgbColor | null {
  const sorted = [...backdrops].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const low = sorted[0];
  const high = sorted.at(-1);
  if (!low || !high) return foreground;
  const passes = (color: SrgbColor) => {
    const luma = relativeLuminance(color);
    // Endpoints alone can both pass while an intermediate gradient color equals text.
    if (luma > relativeLuminance(low) && luma < relativeLuminance(high)) return false;
    return sorted.every(bg => rgba8ContrastRatios(color, bg).minimum >= minimum);
  };
  if (passes(foreground)) return foreground;
  const candidates = [
    ensureRgba8ContrastWithReport(foreground, high, minimum, {direction: 'lighter'}).color,
    ensureRgba8ContrastWithReport(foreground, low, minimum, {direction: 'darker'}).color,
  ].map(quantizeSrgb8).filter(passes);
  const distance = (c: SrgbColor) => (c.r - foreground.r) ** 2 + (c.g - foreground.g) ** 2 +
    (c.b - foreground.b) ** 2 + (c.a - foreground.a) ** 2;
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}
