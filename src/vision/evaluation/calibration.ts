import {mostLikelyLabel} from './probabilities';
import type {CalibrationBin, CalibrationMetrics, EvaluatedPrediction} from './types';

export function computeCalibrationMetrics<Label extends string>(
    records: readonly EvaluatedPrediction<Label>[],
    labels: readonly Label[],
    binCount = 10,
): CalibrationMetrics {
    if (!Number.isInteger(binCount) || binCount < 1 || binCount > 1000) {
        throw new RangeError(`calibrationBins must be an integer in [1, 1000], received ${binCount}`);
    }
    const accumulators = Array.from({length: binCount}, () => ({
        count: 0,
        confidence: 0,
        correct: 0,
    }));
    let brierTotal = 0;

    for (const record of records) {
        for (const label of labels) {
            const error = record.probabilities[label] - (record.actual === label ? 1 : 0);
            brierTotal += error * error;
        }

        // Calibration measures the probability distribution independently of
        // the downstream accept/abstain policy.
        const topLabel = mostLikelyLabel(labels, record.probabilities);
        const confidence = record.probabilities[topLabel];
        const index = Math.min(binCount - 1, Math.floor(confidence * binCount));
        const bin = accumulators[index]!;
        bin.count += 1;
        bin.confidence += confidence;
        if (topLabel === record.actual) bin.correct += 1;
    }

    let expectedCalibrationError = 0;
    const calibrationBins: CalibrationBin[] = accumulators.map((bin, index) => {
        const meanConfidence = bin.count === 0 ? 0 : bin.confidence / bin.count;
        const accuracy = bin.count === 0 ? 0 : bin.correct / bin.count;
        const gap = Math.abs(accuracy - meanConfidence);
        if (records.length > 0) expectedCalibrationError += (bin.count / records.length) * gap;
        return {
            lowerBound: index / binCount,
            upperBound: (index + 1) / binCount,
            count: bin.count,
            meanConfidence,
            accuracy,
            gap,
        };
    });

    return {
        brierScore: records.length === 0 ? 0 : brierTotal / records.length,
        expectedCalibrationError,
        calibrationBins,
    };
}
