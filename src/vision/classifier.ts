import {extractVisionFeatures} from './features';
import type {
    ClassificationScores,
    RGBAImage,
    VisionFeatureOptions,
    VisionFeatures,
    VisualResourceClassification,
    VisualResourceKind,
    VisualResourcePolicy,
} from './types';

const clamp = (value: number, minimum = 0, maximum = 1): number =>
    Math.min(maximum, Math.max(minimum, value));

function sizeSignals(features: VisionFeatures): {large: number; small: number} {
    // 4K pixels is icon-sized; one megapixel is unambiguously large.
    const large = clamp((Math.log2(Math.max(1, features.pixelCount)) - 12) / 8);
    return {large, small: 1 - large};
}

function calculateScores(features: VisionFeatures): ClassificationScores {
    if (features.opaqueSampleCount === 0) {
        return {photo: 0, icon: 0, diagram: 0, screenshot: 0, unknown: 1};
    }

    const {large, small} = sizeSignals(features);
    const bucketRichness = clamp(features.colorBucketCount / 64);
    const paletteRichness = clamp(0.7 * features.colorEntropy + 0.3 * bucketRichness);
    const paletteSimplicity = 1 - paletteRichness;
    const edgeSignal = clamp(features.edgeDensity / 0.2);
    const contrastStructure = clamp((features.darkPixelRatio + features.lightPixelRatio - 0.45) / 0.45);
    const opacity = 1 - features.transparentRatio;
    const saturationDiversity = clamp(features.saturationStdDev / 0.25);

    let photo = 0.33 * features.colorEntropy +
        0.22 * bucketRichness +
        0.15 * large +
        0.1 * opacity +
        0.12 * edgeSignal +
        0.08 * saturationDiversity;
    if (features.colorBucketCount <= 8) {
        photo -= 0.24;
    }
    photo -= 0.22 * clamp((features.transparentRatio - 0.25) / 0.6);

    const iconEvidence = clamp(0.7 * edgeSignal + 0.7 * features.transparentRatio);
    let icon = 0.3 * small +
        0.26 * features.transparentRatio +
        0.2 * paletteSimplicity +
        0.16 * edgeSignal +
        0.08 * (1 - features.translucentRatio);
    icon *= 0.35 + 0.65 * iconEvidence;

    let diagram = 0.24 * large +
        0.24 * edgeSignal +
        0.2 * contrastStructure +
        0.14 * paletteSimplicity +
        0.12 * features.lightPixelRatio +
        0.06 * opacity;
    const diagramStructure = Math.max(edgeSignal, contrastStructure * edgeSignal);
    diagram *= 0.3 + 0.7 * diagramStructure;
    diagram += 0.45 * features.saturatedPixelRatio * contrastStructure * opacity;

    // Screenshots combine a rich palette with repeated text/control edges and
    // strong light/dark surfaces. Photos can be rich or edged, but usually do
    // not exhibit both the UI-like tonal structure and opaque canvas signal.
    let screenshot = 0.2 * large +
        0.2 * edgeSignal +
        0.18 * contrastStructure +
        0.17 * paletteRichness +
        0.12 * features.lightPixelRatio +
        0.08 * opacity +
        0.05 * (1 - features.meanSaturation);
    screenshot *= 0.75 + 0.25 * edgeSignal;
    screenshot += 0.18 * clamp((features.colorBucketCount - 4) / 8);
    screenshot -= 0.28 * features.transparentRatio;

    photo = clamp(photo);
    icon = clamp(icon);
    diagram = clamp(diagram);
    screenshot = clamp(screenshot);

    const flatSignal = features.colorBucketCount <= 2
        ? clamp(1 - features.edgeDensity / 0.025)
        : 0;
    const strongestKnown = Math.max(photo, icon, diagram, screenshot);
    const unknown = clamp(0.7 - strongestKnown + 0.55 * flatSignal);
    return {photo, icon, diagram, screenshot, unknown};
}

export function policyForVisualResource(
    kind: VisualResourceKind,
    features: VisionFeatures,
): VisualResourcePolicy {
    switch (kind) {
        case 'photo':
            return features.meanLuminance >= 0.58 || features.lightPixelRatio >= 0.55 ? 'dim' : 'keep';
        case 'icon':
            return features.meanSaturation <= 0.35 && features.saturatedPixelRatio <= 0.25
                ? 'recolor'
                : 'keep';
        case 'diagram':
            return 'diagram';
        case 'screenshot':
            return features.meanLuminance >= 0.35 || features.lightPixelRatio >= 0.4
                ? 'dim'
                : 'keep';
        default:
            return 'keep';
    }
}

function describeSignals(kind: VisualResourceKind, features: VisionFeatures): string[] {
    const signals: string[] = [];
    if (features.transparentRatio >= 0.25) {
        signals.push('transparent-background');
    }
    if (features.colorEntropy >= 0.55) {
        signals.push('high-color-entropy');
    } else if (features.colorEntropy <= 0.2) {
        signals.push('limited-palette');
    }
    if (features.edgeDensity >= 0.18) {
        signals.push('dense-edges');
    }
    if (features.lightPixelRatio >= 0.55) {
        signals.push('light-dominant');
    }
    if (features.meanSaturation >= 0.5) {
        signals.push('high-saturation');
    }
    if (kind === 'screenshot') {
        signals.push('ui-like-structure');
    }
    if (kind === 'unknown' && features.colorBucketCount <= 2 && features.edgeDensity < 0.025) {
        signals.push('flat-or-empty');
    }
    return signals;
}

/** Classify already-extracted features without touching a DOM or pixel buffer. */
export function classifyVisionFeatures(features: VisionFeatures): VisualResourceClassification {
    const scores = calculateScores(features);
    const ranked = (Object.entries(scores) as Array<[VisualResourceKind, number]>)
        .sort((first, second) => second[1] - first[1]);
    const [kind, topScore] = ranked[0]!;
    const secondScore = ranked[1]![1];
    const margin = topScore - secondScore;
    const confidence = clamp(0.35 + 0.45 * topScore + 0.45 * margin, 0.35, 0.99);

    return {
        kind,
        policy: policyForVisualResource(kind, features),
        confidence,
        scores,
        signals: describeSignals(kind, features),
        features,
    };
}

/** Convenience API that extracts features and classifies a resource in one call. */
export function classifyVisualResource(
    image: RGBAImage,
    options: VisionFeatureOptions = {},
): VisualResourceClassification {
    return classifyVisionFeatures(extractVisionFeatures(image, options));
}
