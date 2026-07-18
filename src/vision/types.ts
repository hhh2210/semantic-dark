export type VisualResourceKind = 'photo' | 'icon' | 'diagram' | 'screenshot' | 'unknown';

export type VisualResourcePolicy = 'keep' | 'dim' | 'recolor' | 'diagram';

/**
 * A row-major RGBA8 pixel buffer. `stride` is measured in bytes and defaults
 * to `width * 4`. The deliberately small interface keeps this module usable in
 * workers without depending on DOM types such as `ImageData`.
 */
export interface RGBAImage {
    data: ArrayLike<number>;
    width: number;
    height: number;
    stride?: number;
}

export interface VisionFeatureOptions {
    /** Maximum number of pixels sampled on a deterministic uniform grid. */
    maxSamples?: number;
    /** Alpha values at or below this value are considered transparent. */
    alphaThreshold?: number;
    /** Relative-luminance delta counted as an edge. */
    edgeThreshold?: number;
    /** Bits retained per RGB channel when building the color histogram. */
    colorBits?: number;
    darkLuminanceThreshold?: number;
    lightLuminanceThreshold?: number;
    saturatedThreshold?: number;
}

export interface VisionFeatures {
    width: number;
    height: number;
    pixelCount: number;
    sampledPixelCount: number;
    opaqueSampleCount: number;

    /** Average normalized alpha: 0 is transparent and 1 is opaque. */
    alphaRatio: number;
    transparentRatio: number;
    translucentRatio: number;

    meanLuminance: number;
    luminanceStdDev: number;
    minLuminance: number;
    maxLuminance: number;
    darkPixelRatio: number;
    lightPixelRatio: number;

    meanSaturation: number;
    saturationStdDev: number;
    saturatedPixelRatio: number;

    colorBucketCount: number;
    colorBucketRatio: number;
    /** Shannon entropy normalized to the possible entropy of this sample. */
    colorEntropy: number;

    /** Share of neighboring sample pairs separated by alpha or luminance. */
    edgeDensity: number;
}

export type ClassificationScores = Record<VisualResourceKind, number>;

export interface VisualResourceClassification {
    kind: VisualResourceKind;
    policy: VisualResourcePolicy;
    confidence: number;
    scores: ClassificationScores;
    signals: string[];
    features: VisionFeatures;
}
