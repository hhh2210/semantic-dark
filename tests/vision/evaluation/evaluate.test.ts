import {describe, expect, it} from 'vitest';

import {
    evaluateVisionClassifier,
    evaluateVisionSamples,
    mostLikelyLabel,
    normalizeClassScores,
    type RGBAImage,
    type VisionEvaluationSample,
} from '../../../src/vision';

function pixel(value: number, alpha = 255): RGBAImage {
    return {data: new Uint8ClampedArray([value, value, value, alpha]), width: 1, height: 1};
}

describe('probability contracts', () => {
    const labels = ['dark', 'light', 'other'] as const;

    it('normalizes partial non-negative scores and resolves ties by label order', () => {
        const probabilities = normalizeClassScores(labels, {dark: 2, light: 1});
        expect(probabilities).toEqual({dark: 2 / 3, light: 1 / 3, other: 0});
        expect(mostLikelyLabel(labels, {dark: 0.5, light: 0.5, other: 0})).toBe('dark');
    });

    it.each([
        [{dark: -1, light: 2}],
        [{dark: Number.POSITIVE_INFINITY, light: 1}],
        [{dark: 0, light: 0, other: 0}],
    ])('rejects invalid score vectors %#', (scores) => {
        expect(() => normalizeClassScores(labels, scores)).toThrow(RangeError);
    });
});

describe('RGBA sample evaluator', () => {
    type Label = 'dark' | 'light';
    const samples: readonly VisionEvaluationSample<Label>[] = [
        {source: 'dark/source', label: 'dark', image: pixel(10)},
        {source: 'light/source', label: 'light', image: pixel(245)},
        {source: 'ambiguous/source', label: 'light', image: pixel(128)},
    ];

    it('passes in-memory RGBA samples to a reusable predictor and normalizes its scores', () => {
        const report = evaluateVisionSamples(samples, (sample) => {
            const value = sample.image.data[0]!;
            if (value < 64) return {label: 'dark', scores: {dark: 9, light: 1}};
            if (value > 192) return {label: 'light', scores: {dark: 1, light: 9}};
            return {label: null, scores: {dark: 1, light: 1}};
        }, {labels: ['dark', 'light']});

        expect(report.sampleCount).toBe(3);
        expect(report.accuracy).toBeCloseTo(2 / 3, 12);
        expect(report.coverage).toBeCloseTo(2 / 3, 12);
        expect(report.selectiveAccuracy).toBe(1);
        expect(report.confusionMatrix.abstainedByActual.light).toBe(1);
    });

    it('rejects empty sources and labels outside the declared taxonomy', () => {
        expect(() => evaluateVisionSamples(
            [{source: '', label: 'dark', image: pixel(0)}],
            () => ({label: 'dark', scores: {dark: 1, light: 0}}),
            {labels: ['dark', 'light']},
        )).toThrow(/source/i);
        expect(() => evaluateVisionSamples(
            samples,
            () => ({label: 'dark', scores: {dark: 1, light: 0}}),
            {labels: ['dark']},
        )).toThrow(/actual label/i);
    });

    it('adapts a fully transparent built-in-classifier sample without undefined calibration', () => {
        const report = evaluateVisionClassifier([
            {source: 'transparent', label: 'icon', image: pixel(0, 0)},
        ]);
        expect(report.abstained).toBe(1);
        expect(report.coverage).toBe(0);
        expect(report.selectiveAccuracy).toBeNull();
        expect(Number.isFinite(report.brierScore)).toBe(true);
        expect(Number.isFinite(report.expectedCalibrationError)).toBe(true);
    });
});
