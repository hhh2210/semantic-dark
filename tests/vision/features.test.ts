import {describe, expect, it} from 'vitest';

import {extractVisionFeatures} from '../../src/vision';
import type {RGBAImage} from '../../src/vision';

function solidImage(width: number, height: number, rgba: readonly number[]): RGBAImage {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) {
        data.set(rgba, index * 4);
    }
    return {data, width, height};
}

describe('extractVisionFeatures', () => {
    it('extracts stable statistics for a solid opaque color', () => {
        const features = extractVisionFeatures(solidImage(4, 4, [255, 255, 255, 255]));

        expect(features.sampledPixelCount).toBe(16);
        expect(features.alphaRatio).toBe(1);
        expect(features.transparentRatio).toBe(0);
        expect(features.meanLuminance).toBeCloseTo(1, 8);
        expect(features.luminanceStdDev).toBe(0);
        expect(features.colorBucketCount).toBe(1);
        expect(features.colorEntropy).toBe(0);
        expect(features.edgeDensity).toBe(0);
    });

    it('measures alpha coverage and alpha boundaries', () => {
        const data = new Uint8ClampedArray([
            255, 255, 255, 0,
            255, 255, 255, 255,
            255, 255, 255, 0,
            255, 255, 255, 255,
        ]);
        const features = extractVisionFeatures({data, width: 2, height: 2});

        expect(features.alphaRatio).toBe(0.5);
        expect(features.transparentRatio).toBe(0.5);
        expect(features.opaqueSampleCount).toBe(2);
        // Three neighboring pairs touch visible pixels; two cross alpha.
        expect(features.edgeDensity).toBeCloseTo(2 / 3, 8);
    });

    it('detects luminance edges in an opaque checkerboard', () => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const value = (x + y) % 2 === 0 ? 0 : 255;
                data.set([value, value, value, 255], (y * 4 + x) * 4);
            }
        }

        const features = extractVisionFeatures({data, width: 4, height: 4});
        expect(features.darkPixelRatio).toBe(0.5);
        expect(features.lightPixelRatio).toBe(0.5);
        expect(features.edgeDensity).toBe(1);
        expect(features.colorBucketCount).toBe(2);
    });

    it('bounds work with deterministic grid sampling', () => {
        const features = extractVisionFeatures(
            solidImage(1000, 500, [80, 120, 160, 255]),
            {maxSamples: 257},
        );
        expect(features.sampledPixelCount).toBeLessThanOrEqual(257);
        expect(features.sampledPixelCount).toBeGreaterThan(0);
    });

    it('supports padded row strides', () => {
        const data = new Uint8ClampedArray(24);
        data.set([0, 0, 0, 255, 255, 255, 255, 255], 0);
        data.set([255, 0, 0, 255, 0, 255, 0, 255], 12);
        const features = extractVisionFeatures({data, width: 2, height: 2, stride: 12});
        expect(features.sampledPixelCount).toBe(4);
        expect(features.colorBucketCount).toBe(4);
    });

    it('rejects malformed buffers and options', () => {
        expect(() => extractVisionFeatures({data: new Uint8Array(3), width: 1, height: 1})).toThrow(RangeError);
        expect(() => extractVisionFeatures(solidImage(1, 1, [0, 0, 0, 255]), {maxSamples: 0})).toThrow(RangeError);
        expect(() => extractVisionFeatures(
            solidImage(1, 1, [0, 0, 0, 255]),
            {darkLuminanceThreshold: 0.8, lightLuminanceThreshold: 0.5},
        )).toThrow(RangeError);
    });
});
