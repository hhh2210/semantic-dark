import {compositeSrgb, contrastRatio, parseCssColor} from '../color';
import type {AssetObservation} from './action-policy';

/** A numeric visibility check for opaque logo strokes over a simple solid backdrop. */
export function logoActionContrast(observation: AssetObservation): Record<'keep' | 'dim' | 'backplate', number> | null {
  const c = observation.classification;
  if (!observation.simpleBackdrop || c.kind !== 'icon' || c.confidence < 0.58 || c.features.transparentRatio <= 0.01) return null;
  const canvas = parseCssColor(observation.canvasBackground);
  const parent = parseCssColor(observation.parentBackground);
  const element = parseCssColor(observation.elementBackground);
  if (!canvas || !parent || !element) return null;
  const background = compositeSrgb(element, compositeSrgb(parent, {...canvas, a: 1}));
  const minimum = {keep: 21, dim: 21, backplate: 21};
  let opaque = 0;
  const data = observation.pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 250) continue;
    opaque++;
    const source = {r: data[i]! / 255, g: data[i + 1]! / 255, b: data[i + 2]! / 255, a: 1};
    const dim = (v: number) => Math.min(1, Math.max(0, 1.04 * 0.82 * v - 0.02));
    minimum.keep = Math.min(minimum.keep, contrastRatio(source, background));
    minimum.dim = Math.min(minimum.dim, contrastRatio({r: dim(source.r), g: dim(source.g), b: dim(source.b), a: 1}, background));
    minimum.backplate = Math.min(minimum.backplate, contrastRatio(source, {r: 1, g: 1, b: 1, a: 1}));
  }
  return opaque >= 8 ? minimum : null;
}
