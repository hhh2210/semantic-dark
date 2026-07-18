import {describe, expect, it} from 'vitest';

import {
    contrastRatio,
    hueDistanceDegrees,
    relativeLuminance,
    srgb,
    srgbToOklch,
} from '../../src/color';
import {recolorRasterDiagram} from '../../src/raster';

import {createImage, rgbaAt, srgbAt, syntheticChart} from './helpers';

const DARK = srgb(18 / 255, 18 / 255, 18 / 255);

describe('recolorRasterDiagram', () => {
    it('recolors a chart by semantic role without inverting accent hue', () => {
        const image = syntheticChart();
        const original = new Uint8ClampedArray(image.data);

        const result = recolorRasterDiagram(image, DARK);

        expect(result.report.status).toBe('recolored');
        expect(result.report.backgroundShare).toBeGreaterThan(0.5);
        expect(result.report.rolePixels.background).toBeGreaterThan(0);
        expect(result.report.rolePixels.text).toBeGreaterThan(0);
        expect(result.report.rolePixels.accent).toBeGreaterThan(0);
        expect(result.report.palette.some((entry) => entry.primaryBackground)).toBe(true);
        expect(result.report.palette.reduce((sum, entry) => sum + entry.sampleShare, 0))
            .toBeCloseTo(1, 10);
        expect(result.data).not.toBe(image.data);
        expect(image.data).toEqual(original);

        const mappedBackground = rgbaAt(result.data, image.width, 0, 0);
        expect(mappedBackground.slice(0, 3)).toEqual([18, 18, 18]);

        const mappedAxis = srgbAt(result.data, image.width, 8, 20);
        expect(contrastRatio(mappedAxis, DARK)).toBeGreaterThanOrEqual(4.5);

        const sourceAccent = srgbAt(image.data, image.width, 20, 20);
        const mappedAccent = srgbAt(result.data, image.width, 20, 20);
        const sourceHue = srgbToOklch(sourceAccent).h;
        const mappedHue = srgbToOklch(mappedAccent).h;
        expect(hueDistanceDegrees(sourceHue, mappedHue)).toBeLessThan(2);
    });

    it('maps an opaque antialiased ramp continuously instead of palette banding', () => {
        const levels = [0, 32, 64, 96, 128, 160, 192, 224, 255];
        const image = createImage(64, 16, (x) => {
            if (x >= 8 && x < 8 + levels.length) {
                const value = levels[x - 8]!;
                return [value, value, value, 255];
            }
            return [255, 255, 255, 255];
        });

        const result = recolorRasterDiagram(image, DARK, {
            paletteSize: 6,
            assignmentSoftness: 0.11,
        });
        expect(result.report.status).toBe('recolored');
        expect(result.report.edgePixels).toBeGreaterThan(0);

        const luminances = levels.map((_value, index) =>
            relativeLuminance(srgbAt(result.data, image.width, 8 + index, 8))
        );
        for (let index = 1; index < luminances.length; index += 1) {
            expect(luminances[index]!).toBeLessThanOrEqual(luminances[index - 1]! + 0.02);
        }
        const distinct = new Set(luminances.map((value) => value.toFixed(3)));
        expect(distinct.size).toBeGreaterThanOrEqual(6);
        const largestStep = Math.max(...luminances.slice(1).map((value, index) =>
            Math.abs(value - luminances[index]!)
        ));
        expect(largestStep).toBeLessThan(0.35);
    });

    it('preserves every alpha byte and leaves effectively transparent RGB untouched', () => {
        const image = createImage(24, 16, (x, y) => {
            if (x === 6 && y === 6) return [220, 40, 50, 128];
            if (x === 7 && y === 6) return [17, 91, 203, 8];
            if (x === 8 && y === 6) return [123, 45, 67, 0];
            return [250, 250, 250, 255];
        });

        const result = recolorRasterDiagram(image, DARK);

        for (let index = 3; index < image.data.length; index += 4) {
            expect(result.data[index]).toBe(image.data[index]);
        }
        expect(rgbaAt(result.data, image.width, 7, 6)).toEqual([17, 91, 203, 8]);
        expect(rgbaAt(result.data, image.width, 8, 6)).toEqual([123, 45, 67, 0]);
        expect(rgbaAt(result.data, image.width, 6, 6).slice(0, 3))
            .not.toEqual([220, 40, 50]);
        expect(result.report.transparentPixels).toBe(2);
    });
});
