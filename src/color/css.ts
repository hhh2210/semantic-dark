import {gamutMapOklch, oklabToOklch} from './oklab';
import {quantizeSrgb8} from './srgb';
import {clamp01, normalizeHueDegrees, srgb, type SrgbColor} from './types';

const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  aqua: [0, 255, 255],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  fuchsia: [255, 0, 255],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  grey: [128, 128, 128],
  lime: [0, 255, 0],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  silver: [192, 192, 192],
  teal: [0, 128, 128],
  white: [255, 255, 255],
  yellow: [255, 255, 0],
};

/** Parse the solid CSS color forms emitted by Chrome computed styles and SVG. */
export function parseCssColor(value: string): SrgbColor | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'transparent') return srgb(0, 0, 0, 0);

  const named = NAMED_COLORS[normalized];
  if (named) return srgb(named[0] / 255, named[1] / 255, named[2] / 255);
  if (normalized.startsWith('#')) return parseHex(normalized.slice(1));

  const functional = normalized.match(/^([a-z]+)\((.*)\)$/s);
  if (!functional) return null;
  const name = functional[1];
  const body = functional[2];
  if (!name || body === undefined) return null;

  if (name === 'rgb' || name === 'rgba') return parseRgb(body);
  if (name === 'hsl' || name === 'hsla') return parseHsl(body);
  if (name === 'oklab') return parseOklab(body);
  if (name === 'oklch') return parseOklch(body);
  if (name === 'color') return parseColorFunction(body);
  return null;
}

/** Serialize without 8-bit quantization for source normalization and round trips. */
export function formatCssColor(color: SrgbColor): string {
  const red = trimNumber(clamp01(color.r) * 255, 5);
  const green = trimNumber(clamp01(color.g) * 255, 5);
  const blue = trimNumber(clamp01(color.b) * 255, 5);
  const alpha = clamp01(color.a);
  return alpha >= 1 - 1e-8
    ? `rgb(${red} ${green} ${blue})`
    : `rgb(${red} ${green} ${blue} / ${trimNumber(alpha, 6)})`;
}

/** Serialize mapped output on Chrome's RGBA8 paint grid. */
export function formatRgba8CssColor(color: SrgbColor): string {
  const quantized = quantizeSrgb8(color);
  const red = Math.round(quantized.r * 255);
  const green = Math.round(quantized.g * 255);
  const blue = Math.round(quantized.b * 255);
  const alpha = quantized.a;
  return alpha >= 1 - 1e-8
    ? `rgb(${red} ${green} ${blue})`
    : `rgb(${red} ${green} ${blue} / ${trimNumber(alpha, 6)})`;
}

function parseHex(hex: string): SrgbColor | null {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const expanded = hex.length <= 4
    ? [...hex].map((character) => character + character).join('')
    : hex;
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return srgb(
    Number.parseInt(expanded.slice(0, 2), 16) / 255,
    Number.parseInt(expanded.slice(2, 4), 16) / 255,
    Number.parseInt(expanded.slice(4, 6), 16) / 255,
    alpha,
  );
}

function parseRgb(body: string): SrgbColor | null {
  const split = splitChannels(body);
  if (!split || split.channels.length !== 3) return null;
  const channels = split.channels.map(parseRgbChannel);
  const alpha = parseAlpha(split.alpha);
  if (channels.some((channel) => channel === null) || alpha === null) return null;
  return srgb(channels[0]!, channels[1]!, channels[2]!, alpha);
}

function parseHsl(body: string): SrgbColor | null {
  const split = splitChannels(body);
  if (!split || split.channels.length !== 3) return null;
  const hue = parseAngle(split.channels[0]!);
  const saturation = parsePercentage(split.channels[1]!);
  const lightness = parsePercentage(split.channels[2]!);
  const alpha = parseAlpha(split.alpha);
  if (hue === null || saturation === null || lightness === null || alpha === null) return null;

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = normalizeHueDegrees(hue) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] = hslSector(sector, chroma, x);
  const offset = lightness - chroma / 2;
  return srgb(red + offset, green + offset, blue + offset, alpha);
}

function parseOklab(body: string): SrgbColor | null {
  const split = splitChannels(body);
  if (!split || split.channels.length !== 3) return null;
  const lightness = parseUnitInterval(split.channels[0]!);
  const a = parseLabAxis(split.channels[1]!);
  const b = parseLabAxis(split.channels[2]!);
  const alpha = parseAlpha(split.alpha);
  if (lightness === null || a === null || b === null || alpha === null) return null;
  return gamutMapOklch(oklabToOklch({l: lightness, a, b, alpha}));
}

function parseOklch(body: string): SrgbColor | null {
  const split = splitChannels(body);
  if (!split || split.channels.length !== 3) return null;
  const lightness = parseUnitInterval(split.channels[0]!);
  const chroma = parseChroma(split.channels[1]!);
  const hue = parseAngle(split.channels[2]!);
  const alpha = parseAlpha(split.alpha);
  if (lightness === null || chroma === null || hue === null || alpha === null) return null;
  return gamutMapOklch({l: lightness, c: chroma, h: hue, alpha});
}

function parseColorFunction(body: string): SrgbColor | null {
  const tokens = tokenize(body);
  if (tokens.shift() !== 'srgb') return null;
  const split = splitChannels(tokens.join(' '));
  if (!split || split.channels.length !== 3) return null;
  const channels = split.channels.map((token) => {
    const value = parseFinite(token);
    if (value === null) return null;
    return clamp01(token.endsWith('%') ? value / 100 : value);
  });
  const alpha = parseAlpha(split.alpha);
  if (channels.some((channel) => channel === null) || alpha === null) return null;
  return srgb(channels[0]!, channels[1]!, channels[2]!, alpha);
}

function splitChannels(body: string): {channels: string[]; alpha?: string} | null {
  const tokens = tokenize(body);
  const slash = tokens.indexOf('/');
  if (slash >= 0) {
    if (tokens.indexOf('/', slash + 1) >= 0 || tokens.length !== slash + 2) return null;
    return {channels: tokens.slice(0, slash), alpha: tokens[slash + 1]!};
  }
  if (tokens.length === 4) return {channels: tokens.slice(0, 3), alpha: tokens[3]!};
  return tokens.length === 3 ? {channels: tokens} : null;
}

function tokenize(body: string): string[] {
  return body.replaceAll(',', ' ').replaceAll('/', ' / ').trim().split(/\s+/).filter(Boolean);
}

function parseRgbChannel(token: string): number | null {
  const value = parseFinite(token);
  if (value === null) return null;
  return clamp01(token.endsWith('%') ? value / 100 : value / 255);
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const value = parseFinite(token);
  if (value === null) return null;
  return clamp01(token.endsWith('%') ? value / 100 : value);
}

function parsePercentage(token: string): number | null {
  if (!token.endsWith('%')) return null;
  const value = parseFinite(token);
  return value === null ? null : clamp01(value / 100);
}

function parseUnitInterval(token: string): number | null {
  const value = parseFinite(token);
  if (value === null) return null;
  return clamp01(token.endsWith('%') ? value / 100 : value);
}

function parseLabAxis(token: string): number | null {
  const value = parseFinite(token);
  if (value === null) return null;
  return token.endsWith('%') ? value * 0.004 : value;
}

function parseChroma(token: string): number | null {
  const value = parseFinite(token);
  if (value === null) return null;
  return Math.max(0, token.endsWith('%') ? value * 0.004 : value);
}

function parseAngle(token: string): number | null {
  const value = parseFinite(token);
  if (value === null) return null;
  if (token.endsWith('turn')) return value * 360;
  if (token.endsWith('grad')) return value * 0.9;
  if (token.endsWith('rad')) return (value * 180) / Math.PI;
  return value;
}

function parseFinite(token: string): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|grad|rad|turn)?$/i.test(token)) {
    return null;
  }
  const value = Number.parseFloat(token);
  return Number.isFinite(value) ? value : null;
}

function hslSector(sector: number, chroma: number, x: number): [number, number, number] {
  if (sector < 1) return [chroma, x, 0];
  if (sector < 2) return [x, chroma, 0];
  if (sector < 3) return [0, chroma, x];
  if (sector < 4) return [0, x, chroma];
  if (sector < 5) return [x, 0, chroma];
  return [chroma, 0, x];
}

function trimNumber(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}
