import type {EvaluatedPrediction, SelectiveMetrics} from './types';

export function computeSelectiveMetrics<Label extends string>(
    records: readonly EvaluatedPrediction<Label>[],
): SelectiveMetrics {
    let accepted = 0;
    let correctAccepted = 0;
    for (const record of records) {
        if (record.predicted === null) continue;
        accepted += 1;
        if (record.predicted === record.actual) correctAccepted += 1;
    }
    const abstained = records.length - accepted;
    const coverage = records.length === 0 ? 0 : accepted / records.length;
    const selectiveAccuracy = accepted === 0 ? null : correctAccepted / accepted;
    return {
        accepted,
        abstained,
        correctAccepted,
        coverage,
        abstainRate: records.length === 0 ? 0 : abstained / records.length,
        selectiveAccuracy,
        selectiveRisk: selectiveAccuracy === null ? null : 1 - selectiveAccuracy,
    };
}
