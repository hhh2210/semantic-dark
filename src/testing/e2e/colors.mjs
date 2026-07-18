import assert from 'node:assert/strict';

export function parseRgb(input) {
  const match = input.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  assert.ok(match, `Expected an rgb()/rgba() color, received ${JSON.stringify(input)}`);
  return match.slice(1, 4).map(Number);
}

export function parseRgbColors(input) {
  const matches = [...input.matchAll(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/gi)];
  return matches.map((match) => match.slice(1, 4).map(Number));
}

export function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function colorsNear(actual, expected, tolerance = 1) {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}
