import {describe, expect, it} from 'vitest';

import {classifyVisualResource} from '../../src/vision';
import type {RGBAImage, VisualResourcePolicy} from '../../src/vision';

function createImage(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): RGBAImage {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set(pixel(x, y), (y * width + x) * 4);
        }
    }
    return {data, width, height};
}

function pseudoRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

describe('classifyVisualResource', () => {
    it('recognizes a transparent monochrome icon and recommends recoloring', () => {
        const icon = createImage(32, 32, (x, y) => {
            const isPlus = Math.abs(x - 15.5) <= 3 || Math.abs(y - 15.5) <= 3;
            return isPlus ? [235, 235, 235, 255] : [0, 0, 0, 0];
        });
        const result = classifyVisualResource(icon);

        expect(result.kind).toBe('icon');
        expect(result.policy).toBe('recolor');
        expect(result.signals).toContain('transparent-background');
    });

    it('preserves semantic color in a saturated icon', () => {
        const icon = createImage(48, 48, (x, y) => {
            const inside = (x - 24) ** 2 + (y - 24) ** 2 <= 16 ** 2;
            return inside ? [230, 30, 40, 255] : [0, 0, 0, 0];
        });
        const result = classifyVisualResource(icon);

        expect(result.kind).toBe('icon');
        expect(result.policy).toBe<VisualResourcePolicy>('keep');
    });

    it('recognizes a high-entropy bright photo and recommends dimming', () => {
        const random = pseudoRandom(42);
        const photo = createImage(192, 128, () => [
            150 + Math.floor(random() * 106),
            150 + Math.floor(random() * 106),
            150 + Math.floor(random() * 106),
            255,
        ]);
        const result = classifyVisualResource(photo);

        expect(result.kind).toBe('photo');
        expect(result.policy).toBe('dim');
        expect(result.signals).toContain('high-color-entropy');
    });

    it('recognizes a structured light-background diagram', () => {
        const diagram = createImage(256, 128, (x, y) => {
            if (x % 32 === 0 || y % 32 === 0) {
                return [55, 60, 68, 255];
            }
            if (y > 48 && x > 36 && x < 76) {
                return [30, 105, 180, 255];
            }
            if (y > 72 && x > 100 && x < 140) {
                return [175, 95, 35, 255];
            }
            if (y > 32 && x > 164 && x < 204) {
                return [65, 145, 85, 255];
            }
            return [250, 250, 248, 255];
        });
        const result = classifyVisualResource(diagram);

        expect(result.kind).toBe('diagram');
        expect(result.policy).toBe('diagram');
        expect(result.features.lightPixelRatio).toBeGreaterThan(0.5);
    });

    it('recognizes an opaque UI screenshot separately from a chart', () => {
        const screenshot = createImage(320, 200, (x, y) => {
            if (y < 24) return [30, 38, 48, 255];
            if (x < 58) return [235, 239, 244, 255];
            if ((y > 45 && y < 52 && x > 82 && x < 250) ||
                (y > 66 && y < 72 && x > 82 && x < 220) ||
                (y > 148 && y < 154 && x > 90 && x < 285)) {
                return [50, 60, 72, 255];
            }
            if (y > 88 && y < 136 && x > 82 && x < 142) return [74, 144, 226, 255];
            if (y > 88 && y < 136 && x > 154 && x < 214) return [238, 168, 65, 255];
            if (y > 88 && y < 136 && x > 226 && x < 286) return [91, 184, 132, 255];
            return [249, 250, 252, 255];
        });

        const result = classifyVisualResource(screenshot);

        expect(result.kind).toBe('screenshot');
        expect(result.policy).toBe('dim');
        expect(result.signals).toContain('ui-like-structure');
    });

    it('abstains on a flat surface', () => {
        const surface = createImage(300, 200, () => [245, 245, 245, 255]);
        const result = classifyVisualResource(surface);

        expect(result.kind).toBe('unknown');
        expect(result.policy).toBe('keep');
        expect(result.signals).toContain('flat-or-empty');
    });

    it('returns bounded scores and confidence', () => {
        const result = classifyVisualResource(createImage(8, 8, () => [0, 0, 0, 0]));
        expect(result.kind).toBe('unknown');
        expect(result.confidence).toBeGreaterThanOrEqual(0.35);
        expect(result.confidence).toBeLessThanOrEqual(0.99);
        for (const score of Object.values(result.scores)) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        }
    });
});
