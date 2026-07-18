export type SvgPaintProperty = "fill" | "stroke" | "stop-color";

export type SvgPaintRole =
    | "text"
    | "text-outline"
    | "graphic"
    | "gradient-stop";

export interface SvgRelatedPaints {
    fill: string | null;
    stroke: string | null;
    paintOrder: string;
    strokeWidth: number;
}

/**
 * The narrow contract between SVG semantics and the shared color engine.
 *
 * The SVG layer identifies paint roles and relationships. The color layer owns
 * color-space conversion, contrast enforcement, and gamut mapping.
 */
export interface SvgColorRequest {
    role: SvgPaintRole;
    property: SvgPaintProperty;
    background: string;
    sourceBackground: string;
    preserveHue: boolean;
    minContrast?: number;
    relatedPaints?: SvgRelatedPaints;
}

export interface SvgColorTransformer {
    mapColor(color: string, request: SvgColorRequest): string;
}

export interface SvgTransformOptions {
    /** Defaults to the repository's OKLCH role mapper. */
    colors?: SvgColorTransformer;
    darkBackground: string;
    sourceBackground?: string;
    /** Minimum visible stroke width considered an intentional text outline. */
    haloMinStrokeWidth?: number;
    /** Maximum sRGB distance from the source background, in the 0..441 range. */
    haloColorDistance?: number;
    /** Minimum SVG viewport fraction covered by a background-colored rect. */
    backdropMinCoverage?: number;
}

export interface SvgTransformReport {
    textPaintGroups: number;
    backgroundHalos: number;
    backdrops: number;
    graphicPaints: number;
    gradientStops: number;
    currentColorResolutions: number;
    skippedPaints: number;
}

export interface SvgTransformSession {
    readonly report: Readonly<SvgTransformReport>;
    /** Restore every changed attribute and inline declaration exactly. */
    restore(): void;
}
