import {describe, expect, it} from 'vitest';
import {invertLightness} from '../../src/color/invert-lightness';
import {srgb} from '../../src/color/types';

// Reference vectors from WebKit's color-filter-apple-invert-lightness.html
// at 549bd1fb46a60fc3d27f30d7cf32fc04611d73a3 (license: THIRD_PARTY_NOTICES.txt).
const vectors = [
  [[0, 0, 0], [255, 255, 255]],
  [[255, 255, 255], [51, 51, 51]],
  [[235, 235, 235], [67, 67, 67]],
  [[214, 214, 214], [84, 84, 84]],
  [[170, 170, 170], [119, 119, 119]],
  [[96, 96, 96], [178, 178, 178]],
  [[0, 54, 74], [199, 242, 255]],
  [[17, 5, 59], [222, 212, 255]],
  [[92, 7, 0], [252, 184, 178]],
  [[102, 97, 0], [246, 242, 165]],
  [[38, 62, 15], [220, 240, 202]],
  [[0, 97, 255], [68, 146, 255]],
  [[255, 170, 0], [237, 169, 33]],
  [[255, 98, 81], [184, 58, 45]],
  [[135, 78, 254], [111, 66, 206]],
  [[150, 211, 95], [122, 171, 77]],
] as const;

describe('WebKit lightness inversion', () => {
  it.each(vectors)('matches upstream RGB %j → %j within one byte', (input, expected) => {
    const result = invertLightness(srgb(input[0] / 255, input[1] / 255, input[2] / 255));
    [result.r, result.g, result.b].forEach((channel, index) => {
      // WebKit uses float32; JS arithmetic uses float64.
      expect(Math.abs(Math.round(channel * 255) - expected[index]!)).toBeLessThanOrEqual(1);
    });
  });

  it('preserves alpha, including fully transparent colors', () => {
    for (const alpha of [0, 0.01, 0.25, 0.5, 1]) {
      expect(invertLightness(srgb(0.2, 0.4, 0.8, alpha)).a).toBe(alpha);
    }
  });

  it('keeps neutral lightness monotonic across the entire byte ramp', () => {
    let previous = 2;
    for (let byte = 0; byte <= 255; byte++) {
      const mapped = invertLightness(srgb(byte / 255, byte / 255, byte / 255));
      expect(mapped.r).toBeLessThan(previous);
      expect(Math.abs(mapped.r - mapped.g)).toBeLessThan(1 / 255);
      expect(Math.abs(mapped.r - mapped.b)).toBeLessThan(1 / 255);
      previous = mapped.r;
    }
  });
});
