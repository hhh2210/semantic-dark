import {describe, expect, it} from 'vitest';

import {
    assertSourceDisjointSplits,
    validateSourceDisjointSplits,
    type RGBAImage,
    type VisionEvaluationSample,
} from '../../../src/vision';

type Label = 'photo' | 'icon';
const image: RGBAImage = {data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1};

function sample(source: string, label: Label = 'photo'): VisionEvaluationSample<Label> {
    return {source, label, image};
}

describe('source-disjoint split validation', () => {
    it('detects and explains the same canonical source crossing split boundaries', () => {
        const splits = {
            train: [sample('site/a'), sample('site/a', 'icon')],
            validation: [sample('site/a')],
            test: [sample('site/b')],
        };
        const result = validateSourceDisjointSplits(splits);
        expect(result.valid).toBe(false);
        expect(result.totalSamples).toBe(4);
        expect(result.uniqueSources).toBe(2);
        expect(result.leakedSourceCount).toBe(1);
        expect(result.leaks).toEqual([{
            source: 'site/a',
            splits: ['train', 'validation'],
            sampleCounts: {train: 2, validation: 1},
        }]);
        expect(() => assertSourceDisjointSplits(splits)).toThrow(/site\/a.*train, validation/i);
    });

    it('allows repeated augmentations from one source inside a single split', () => {
        const result = validateSourceDisjointSplits({
            train: [sample('site/a'), sample('site/a'), sample('site/b')],
            test: [sample('site/c')],
        });
        expect(result.valid).toBe(true);
        expect(result.leaks).toEqual([]);
        expect(result.uniqueSources).toBe(3);
    });

    it('supports caller-defined grouping for derivatives of one original asset', () => {
        const result = validateSourceDisjointSplits({
            train: [sample('site/a#crop-1')],
            test: [sample('site/a#crop-2')],
        }, {sourceKey: (source) => source.split('#')[0]!});
        expect(result.valid).toBe(false);
        expect(result.leakedSourceCount).toBe(1);
    });

    it('rejects empty source identifiers', () => {
        expect(() => validateSourceDisjointSplits({train: [sample('  ')], test: []})).toThrow(/source/i);
    });
});
