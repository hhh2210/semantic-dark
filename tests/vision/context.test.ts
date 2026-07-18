import {describe, expect, it} from 'vitest';

import {
    classifyVisualResource,
    refineVisualResourceClassification,
    type RGBAImage,
} from '../../src/vision';

function uiLikePixels(): RGBAImage {
    const width = 160;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const darkLine = y < 12 || (y % 22 < 3 && x > 30);
            const bar = x > 45 && x < 110 && y > 34 && y < 74;
            const color = darkLine ? [40, 48, 60, 255]
                : bar ? [30, 105, 180, 255]
                    : [250, 250, 248, 255];
            data.set(color, (y * width + x) * 4);
        }
    }
    return {data, width, height};
}

describe('refineVisualResourceClassification', () => {
    it('uses strong chart metadata to correct an ambiguous pixel prediction', () => {
        const base = classifyVisualResource(uiLikePixels());
        const refined = refineVisualResourceClassification(base, {
            alternativeText: 'Quarterly revenue bar chart',
            url: '/assets/report-figure.svg',
        });

        expect(refined.kind).toBe('diagram');
        expect(refined.policy).toBe('diagram');
        expect(refined.signals).toContain('context:diagram');
        expect(refined.scores.diagram).toBeGreaterThan(base.scores.diagram);
    });

    it('returns the original immutable result when metadata has no evidence', () => {
        const base = classifyVisualResource(uiLikePixels());
        const refined = refineVisualResourceClassification(base, {alternativeText: 'Quarterly results'});
        expect(refined).toBe(base);
    });

    it('recognizes explicit screenshot language without treating it as unknown', () => {
        const base = classifyVisualResource(uiLikePixels());
        const refined = refineVisualResourceClassification(base, {
            title: 'Dashboard screenshot',
        });
        expect(refined.kind).toBe('screenshot');
        expect(refined.policy).toBe('dim');
    });
});
