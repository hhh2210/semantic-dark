import type {RGBAImage, VisionFeatureOptions, VisualResourceKind} from '../types';

export type EvaluatedVisualResourceKind = Exclude<VisualResourceKind, 'unknown'>;

export interface VisionEvaluationSample<Label extends string = EvaluatedVisualResourceKind> {
    /** Stable group identifier used to prevent source leakage across splits. */
    source: string;
    label: Label;
    image: RGBAImage;
    id?: string;
}

export interface VisionPrediction<Label extends string> {
    /** `null` is an explicit abstention. */
    label: Label | null;
    /** Non-negative class scores; the evaluator normalizes them to sum to one. */
    scores: Readonly<Partial<Record<Label, number>>>;
}

export type VisionPredictor<Label extends string> = (
    sample: VisionEvaluationSample<Label>,
) => VisionPrediction<Label>;

export interface EvaluatedPrediction<Label extends string> {
    actual: Label;
    predicted: Label | null;
    probabilities: Readonly<Record<Label, number>>;
}

export interface ConfusionMatrix<Label extends string> {
    labels: readonly Label[];
    /** Rows are actual labels and columns are accepted predicted labels. */
    counts: Readonly<Record<Label, Readonly<Record<Label, number>>>>;
    /** Abstentions are separate columns so they remain visible and count as false negatives. */
    abstainedByActual: Readonly<Record<Label, number>>;
    total: number;
}

export interface PerClassMetrics {
    support: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
}

export interface ClassificationMetrics<Label extends string> {
    confusionMatrix: ConfusionMatrix<Label>;
    perClass: Readonly<Record<Label, PerClassMetrics>>;
    accuracy: number;
    macroF1: number;
    microPrecision: number;
    microRecall: number;
    microF1: number;
}

export interface CalibrationBin {
    lowerBound: number;
    upperBound: number;
    count: number;
    meanConfidence: number;
    accuracy: number;
    gap: number;
}

export interface CalibrationMetrics {
    /** Multiclass Brier score: mean sum of squared class-probability errors. */
    brierScore: number;
    expectedCalibrationError: number;
    calibrationBins: readonly CalibrationBin[];
}

export interface SelectiveMetrics {
    accepted: number;
    abstained: number;
    correctAccepted: number;
    coverage: number;
    abstainRate: number;
    /** Undefined at zero coverage, represented explicitly rather than as a misleading zero. */
    selectiveAccuracy: number | null;
    selectiveRisk: number | null;
}

export interface VisionEvaluationReport<Label extends string>
    extends ClassificationMetrics<Label>, CalibrationMetrics, SelectiveMetrics {
    labels: readonly Label[];
    sampleCount: number;
}

export interface VisionEvaluationOptions<Label extends string> {
    labels: readonly Label[];
    calibrationBins?: number;
}

export interface BuiltInVisionEvaluationOptions {
    calibrationBins?: number;
    featureOptions?: VisionFeatureOptions;
}
