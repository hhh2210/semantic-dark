import {assertValidLabels, createLabelRecord} from './probabilities';
import type {
    ClassificationMetrics,
    ConfusionMatrix,
    EvaluatedPrediction,
    PerClassMetrics,
} from './types';

export function computeClassificationMetrics<Label extends string>(
    records: readonly EvaluatedPrediction<Label>[],
    labels: readonly Label[],
): ClassificationMetrics<Label> {
    assertValidLabels(labels);
    const labelSet = new Set<string>(labels);
    const counts = createLabelRecord(labels, () => createLabelRecord(labels, () => 0));
    const abstainedByActual = createLabelRecord(labels, () => 0);

    for (const record of records) {
        if (!labelSet.has(record.actual)) throw new TypeError(`Unknown actual label: ${record.actual}`);
        if (record.predicted === null) {
            abstainedByActual[record.actual] += 1;
        } else {
            if (!labelSet.has(record.predicted)) {
                throw new TypeError(`Unknown predicted label: ${record.predicted}`);
            }
            counts[record.actual][record.predicted] += 1;
        }
    }

    const confusionMatrix: ConfusionMatrix<Label> = {
        labels: [...labels],
        counts,
        abstainedByActual,
        total: records.length,
    };
    const perClass = createLabelRecord(labels, (label): PerClassMetrics => {
        const truePositive = counts[label][label];
        const falsePositive = labels.reduce(
            (sum, actual) => sum + (actual === label ? 0 : counts[actual][label]),
            0,
        );
        const support = labels.reduce((sum, predicted) => sum + counts[label][predicted], 0) +
            abstainedByActual[label];
        const falseNegative = support - truePositive;
        const precision = divideOrZero(truePositive, truePositive + falsePositive);
        const recall = divideOrZero(truePositive, truePositive + falseNegative);
        return {
            support,
            truePositive,
            falsePositive,
            falseNegative,
            precision,
            recall,
            f1: divideOrZero(2 * precision * recall, precision + recall),
        };
    });

    const truePositive = labels.reduce((sum, label) => sum + perClass[label].truePositive, 0);
    const falsePositive = labels.reduce((sum, label) => sum + perClass[label].falsePositive, 0);
    const falseNegative = labels.reduce((sum, label) => sum + perClass[label].falseNegative, 0);
    const microPrecision = divideOrZero(truePositive, truePositive + falsePositive);
    const microRecall = divideOrZero(truePositive, truePositive + falseNegative);
    return {
        confusionMatrix,
        perClass,
        accuracy: divideOrZero(truePositive, records.length),
        macroF1: labels.reduce((sum, label) => sum + perClass[label].f1, 0) / labels.length,
        microPrecision,
        microRecall,
        microF1: divideOrZero(2 * microPrecision * microRecall, microPrecision + microRecall),
    };
}

function divideOrZero(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}
