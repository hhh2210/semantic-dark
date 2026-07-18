import {describe, expect, it} from 'vitest';

import {
    evaluateVisionPredictions,
    type EvaluatedPrediction,
} from '../../../src/vision';

const LABELS = ['photo', 'icon', 'diagram'] as const;
type Label = typeof LABELS[number];

const RECORDS: readonly EvaluatedPrediction<Label>[] = [
    {actual: 'photo', predicted: 'photo', probabilities: {photo: 0.8, icon: 0.1, diagram: 0.1}},
    {actual: 'photo', predicted: 'icon', probabilities: {photo: 0.2, icon: 0.7, diagram: 0.1}},
    {actual: 'icon', predicted: 'icon', probabilities: {photo: 0.1, icon: 0.8, diagram: 0.1}},
    {actual: 'icon', predicted: null, probabilities: {photo: 0.2, icon: 0.6, diagram: 0.2}},
    {actual: 'diagram', predicted: 'photo', probabilities: {photo: 0.6, icon: 0.1, diagram: 0.3}},
];

describe('vision evaluation metric oracle', () => {
    const report = evaluateVisionPredictions(RECORDS, {labels: LABELS, calibrationBins: 5});

    it('constructs a complete confusion matrix with a separate abstain column', () => {
        expect(report.confusionMatrix.counts.photo).toEqual({photo: 1, icon: 1, diagram: 0});
        expect(report.confusionMatrix.counts.icon).toEqual({photo: 0, icon: 1, diagram: 0});
        expect(report.confusionMatrix.counts.diagram).toEqual({photo: 1, icon: 0, diagram: 0});
        expect(report.confusionMatrix.abstainedByActual).toEqual({photo: 0, icon: 1, diagram: 0});
        expect(report.confusionMatrix.total).toBe(5);
    });

    it('computes per-class, macro, and micro metrics with abstains as false negatives', () => {
        expect(report.perClass.photo).toMatchObject({
            support: 2,
            truePositive: 1,
            falsePositive: 1,
            falseNegative: 1,
            precision: 0.5,
            recall: 0.5,
            f1: 0.5,
        });
        expect(report.perClass.icon).toMatchObject({precision: 0.5, recall: 0.5, f1: 0.5});
        expect(report.perClass.diagram).toMatchObject({precision: 0, recall: 0, f1: 0});
        expect(report.accuracy).toBeCloseTo(0.4, 12);
        expect(report.macroF1).toBeCloseTo(1 / 3, 12);
        expect(report.microPrecision).toBeCloseTo(0.5, 12);
        expect(report.microRecall).toBeCloseTo(0.4, 12);
        expect(report.microF1).toBeCloseTo(4 / 9, 12);
    });

    it('matches hand-computed Brier score and equal-width ECE', () => {
        expect(report.brierScore).toBeCloseTo(0.472, 12);
        expect(report.expectedCalibrationError).toBeCloseTo(0.26, 12);
        expect(report.calibrationBins).toHaveLength(5);
        expect(report.calibrationBins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
    });

    it('reports coverage and accuracy conditional on acceptance', () => {
        expect(report.accepted).toBe(4);
        expect(report.abstained).toBe(1);
        expect(report.correctAccepted).toBe(2);
        expect(report.coverage).toBeCloseTo(0.8, 12);
        expect(report.abstainRate).toBeCloseTo(0.2, 12);
        expect(report.selectiveAccuracy).toBeCloseTo(0.5, 12);
        expect(report.selectiveRisk).toBeCloseTo(0.5, 12);
    });
});

describe('metric properties', () => {
    it('preserves count and rate invariants over seeded random predictions', () => {
        const next = random(0xe7a1);
        const records: EvaluatedPrediction<Label>[] = [];
        for (let index = 0; index < 600; index += 1) {
            const raw = [next(), next(), next()];
            const total = raw[0]! + raw[1]! + raw[2]!;
            const probabilities = {
                photo: raw[0]! / total,
                icon: raw[1]! / total,
                diagram: raw[2]! / total,
            };
            const actual = LABELS[Math.floor(next() * LABELS.length)]!;
            const predicted = next() < 0.2
                ? null
                : LABELS[Math.floor(next() * LABELS.length)]!;
            records.push({actual, predicted, probabilities});
        }

        const report = evaluateVisionPredictions(records, {labels: LABELS, calibrationBins: 12});
        const matrixTotal = LABELS.reduce((sum, actual) =>
            sum + LABELS.reduce(
                (row, predicted) => row + report.confusionMatrix.counts[actual][predicted],
                report.confusionMatrix.abstainedByActual[actual],
            ), 0);
        expect(matrixTotal).toBe(records.length);
        expect(LABELS.reduce((sum, label) => sum + report.perClass[label].support, 0)).toBe(records.length);
        expect(report.accepted + report.abstained).toBe(records.length);
        expect(report.microRecall).toBeCloseTo(report.accuracy, 12);
        expect(report.microPrecision).toBeCloseTo(report.selectiveAccuracy!, 12);
        for (const value of [report.macroF1, report.microF1, report.brierScore / 2,
            report.expectedCalibrationError, report.coverage, report.selectiveAccuracy!]) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
    });
});

function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}
