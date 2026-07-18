import {describe, expect, it} from 'vitest';

import {srgb} from '../../src/color';
import {recolorRasterDiagram} from '../../src/raster';

import {createImage, syntheticChart} from './helpers';

const DARK = srgb(0.05, 0.06, 0.07);

describe('raster recolor bounds and abstention', () => {
    it('abstains unchanged before analysis when the hard pixel budget is exceeded', () => {
        const image = createImage(20, 20, () => [250, 250, 250, 255]);
        const result = recolorRasterDiagram(image, DARK, {maxPixels: 399});

        expect(result.report).toMatchObject({
            status: 'abstained',
            reason: 'pixel-budget',
            sampledPixels: 0,
            recoloredPixels: 0,
        });
        expect(result.data).not.toBe(image.data);
        expect(result.data).toEqual(image.data);
    });

    it('abstains on a palette with no dominant global or border background', () => {
        const colors = [
            [220, 40, 50, 255],
            [30, 120, 210, 255],
            [40, 175, 90, 255],
            [235, 165, 25, 255],
        ] as const;
        const image = createImage(40, 40, (x, y) =>
            colors[(x >= 20 ? 1 : 0) + (y >= 20 ? 2 : 0)]!
        );

        const result = recolorRasterDiagram(image, DARK);

        expect(result.report.status).toBe('abstained');
        expect(result.report.reason).toBe('no-dominant-background');
        expect(result.data).toEqual(image.data);
    });

    it('abstains on an all-transparent buffer', () => {
        const image = createImage(8, 8, (x, y) => [x * 20, y * 20, 100, 0]);
        const result = recolorRasterDiagram(image, DARK);
        expect(result.report.reason).toBe('no-opaque-pixels');
        expect(result.data).toEqual(image.data);
    });

    it('is deterministic, bounded, and honors the analysis sample budget', () => {
        const image = syntheticChart(200, 100);
        const options = {maxAnalysisPixels: 503, maxPixels: 25_000};
        const first = recolorRasterDiagram(image, DARK, options);
        const second = recolorRasterDiagram(image, DARK, options);

        expect(first.report.status).toBe('recolored');
        expect(first.report.sampledPixels).toBeLessThanOrEqual(503);
        expect(first.data).toEqual(second.data);
        expect(first.report).toEqual(second.report);
        expect([...first.data].every((value) => value >= 0 && value <= 255)).toBe(true);
    });

    it('rejects malformed buffers and invalid resource bounds', () => {
        expect(() => recolorRasterDiagram(
            {data: new Uint8Array(3), width: 1, height: 1},
            DARK,
        )).toThrow(RangeError);
        const image = createImage(2, 2, () => [255, 255, 255, 255]);
        expect(() => recolorRasterDiagram(image, DARK, {paletteSize: 1}))
            .toThrow(RangeError);
        expect(() => recolorRasterDiagram(image, DARK, {assignmentSoftness: 0}))
            .toThrow(RangeError);
        expect(() => recolorRasterDiagram(image, srgb(Number.NaN, 0, 0)))
            .toThrow(RangeError);
    });
});
