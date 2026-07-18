import {classifyVisualResource} from '../classifier';
import {computeCalibrationMetrics} from './calibration';
import {computeClassificationMetrics} from './classification-metrics';
import {assertValidLabels, normalizeClassScores} from './probabilities';
import {computeSelectiveMetrics} from './selective';
import type {
    BuiltInVisionEvaluationOptions,
    EvaluatedPrediction,
    EvaluatedVisualResourceKind,
    VisionEvaluationOptions,
    VisionEvaluationReport,
    VisionEvaluationSample,
    VisionPredictor,
} from './types';

export const DEFAULT_VISION_EVALUATION_LABELS = [
    'photo',
    'icon',
    'diagram',
    'screenshot',
] as const satisfies readonly EvaluatedVisualResourceKind[];

/** Evaluate any synchronous predictor over source-tagged in-memory RGBA samples. */
export function evaluateVisionSamples<Label extends string>(
    samples: readonly VisionEvaluationSample<Label>[],
    predictor: VisionPredictor<Label>,
    options: VisionEvaluationOptions<Label>,
): VisionEvaluationReport<Label> {
    assertValidLabels(options.labels);
    if (samples.length === 0) throw new RangeError('Evaluation requires at least one sample');
    const labelSet = new Set<string>(options.labels);
    const records: EvaluatedPrediction<Label>[] = samples.map((sample) => {
        if (!sample.source.trim()) throw new TypeError('Evaluation sample source must not be empty');
        if (!labelSet.has(sample.label)) throw new TypeError(`Unknown actual label: ${sample.label}`);
        const prediction = predictor(sample);
        if (prediction.label !== null && !labelSet.has(prediction.label)) {
            throw new TypeError(`Unknown predicted label: ${prediction.label}`);
        }
        return {
            actual: sample.label,
            predicted: prediction.label,
            probabilities: normalizeClassScores(options.labels, prediction.scores),
        };
    });
    return evaluateVisionPredictions(records, options);
}

/** Aggregate already-normalized predictions, useful for stored or cross-model results. */
export function evaluateVisionPredictions<Label extends string>(
    records: readonly EvaluatedPrediction<Label>[],
    options: VisionEvaluationOptions<Label>,
): VisionEvaluationReport<Label> {
    assertValidLabels(options.labels);
    if (records.length === 0) throw new RangeError('Evaluation requires at least one prediction');
    assertNormalizedRecords(records, options.labels);
    const classification = computeClassificationMetrics(records, options.labels);
    const calibration = computeCalibrationMetrics(
        records,
        options.labels,
        options.calibrationBins ?? 10,
    );
    const selective = computeSelectiveMetrics(records);
    return {
        labels: [...options.labels],
        sampleCount: records.length,
        ...classification,
        ...calibration,
        ...selective,
    };
}

/** Adapter for the repository's built-in known asset classes. */
export function evaluateVisionClassifier(
    samples: readonly VisionEvaluationSample<EvaluatedVisualResourceKind>[],
    options: BuiltInVisionEvaluationOptions = {},
): VisionEvaluationReport<EvaluatedVisualResourceKind> {
    return evaluateVisionSamples(
        samples,
        (sample) => {
            const classification = classifyVisualResource(sample.image, options.featureOptions);
            const scores = {
                photo: classification.scores.photo,
                icon: classification.scores.icon,
                diagram: classification.scores.diagram,
                screenshot: classification.scores.screenshot,
            };
            // A fully unknown image has zero known-class evidence. Uniform
            // conditional scores keep calibration defined while it abstains.
            if (scores.photo + scores.icon + scores.diagram + scores.screenshot === 0) {
                scores.photo = 1;
                scores.icon = 1;
                scores.diagram = 1;
                scores.screenshot = 1;
            }
            return {
                label: classification.kind === 'unknown' ? null : classification.kind,
                scores,
            };
        },
        {
            labels: DEFAULT_VISION_EVALUATION_LABELS,
            ...(options.calibrationBins === undefined ? {} : {calibrationBins: options.calibrationBins}),
        },
    );
}

function assertNormalizedRecords<Label extends string>(
    records: readonly EvaluatedPrediction<Label>[],
    labels: readonly Label[],
): void {
    const labelSet = new Set<string>(labels);
    for (const record of records) {
        if (!labelSet.has(record.actual)) throw new TypeError(`Unknown actual label: ${record.actual}`);
        if (record.predicted !== null && !labelSet.has(record.predicted)) {
            throw new TypeError(`Unknown predicted label: ${record.predicted}`);
        }
        let total = 0;
        for (const label of labels) {
            const probability = record.probabilities[label];
            if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
                throw new RangeError(`Invalid probability for label "${label}": ${probability}`);
            }
            total += probability;
        }
        if (Math.abs(total - 1) > 1e-9) {
            throw new RangeError(`Class probabilities must sum to one, received ${total}`);
        }
    }
}
