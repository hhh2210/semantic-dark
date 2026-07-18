import {isSvgBackdropRect} from './backdrop';
import {sharedSvgColorTransformer} from './color-adapter';
import { MutationJournal } from "./mutation-journal";
import {
    colorsAreNear,
    isSolidPaint,
    localPaintServerId,
    readRelatedPaints,
    resolvePaint,
    strokePaintedBeforeFill,
} from "./paint";
import type {
    SvgColorRequest,
    SvgPaintProperty,
    SvgPaintRole,
    SvgRelatedPaints,
    SvgTransformOptions,
    SvgTransformReport,
    SvgTransformSession,
} from "./types";

const TEXT_SELECTOR = "text, tspan, textPath";
const GRAPHIC_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon, use";
const NON_VISUAL_ANCESTORS = "clipPath, mask, filter";

const DEFAULT_SOURCE_BACKGROUND = "#ffffff";
const DEFAULT_HALO_MIN_STROKE_WIDTH = 1.5;
const DEFAULT_HALO_COLOR_DISTANCE = 24;
const DEFAULT_BACKDROP_MIN_COVERAGE = 0.8;

type NormalizedOptions = Omit<SvgTransformOptions, 'colors'> & {
    colors: NonNullable<SvgTransformOptions['colors']>;
    sourceBackground: string;
    haloMinStrokeWidth: number;
    haloColorDistance: number;
    backdropMinCoverage: number;
};

/**
 * Applies a reversible, paint-role-aware dark transform to one inline SVG.
 * This deliberately does not use a whole-SVG CSS filter.
 */
export function transformInlineSvg(
    root: SVGSVGElement,
    options: SvgTransformOptions,
): SvgTransformSession {
    const transformer = new SvgSemanticTransformer(root, normalizeOptions(options));
    return transformer.transform();
}

class SvgSemanticTransformer {
    private readonly journal = new MutationJournal();
    private readonly processed = new WeakMap<SVGElement, Set<SvgPaintProperty>>();
    private readonly palette = new Map<string, string>();
    private readonly report: SvgTransformReport = {
        textPaintGroups: 0,
        backgroundHalos: 0,
        backdrops: 0,
        graphicPaints: 0,
        gradientStops: 0,
        currentColorResolutions: 0,
        skippedPaints: 0,
    };

    constructor(
        private readonly root: SVGSVGElement,
        private readonly options: NormalizedOptions,
    ) {}

    transform(): SvgTransformSession {
        // Descendants must read inherited source paints before their parent is
        // overridden; otherwise a transformed parent hides the original halo.
        const textElements = Array.from(
            this.root.querySelectorAll<SVGElement>(TEXT_SELECTOR),
        ).reverse();
        for (const element of textElements) {
            this.transformText(element);
        }

        for (const element of this.root.querySelectorAll<SVGElement>(GRAPHIC_SELECTOR)) {
            if (element.closest(TEXT_SELECTOR) || element.closest(NON_VISUAL_ANCESTORS)) {
                continue;
            }
            this.transformGraphic(element);
        }

        // Transform unreferenced definitions too: a later script may point a shape at them.
        for (const stop of this.root.querySelectorAll<SVGStopElement>("stop")) {
            this.transformGradientStop(stop);
        }

        const report = Object.freeze({ ...this.report });
        return {
            report,
            restore: () => this.journal.restore(),
        };
    }

    private transformText(element: SVGElement): void {
        const fill = resolvePaint(element, "fill");
        const stroke = resolvePaint(element, "stroke");
        const relatedPaints = readRelatedPaints(element);
        const hasFill = isSolidPaint(fill.color);
        const hasStroke = isSolidPaint(stroke.color) && relatedPaints.strokeWidth > 0;
        if (!hasFill && !hasStroke) {
            this.report.skippedPaints += 1;
            return;
        }

        this.report.textPaintGroups += 1;
        const backgroundHalo = hasStroke && this.isBackgroundHalo(stroke.color, relatedPaints);

        if (hasFill && this.markProcessed(element, "fill")) {
            this.mapAndWrite(
                element,
                "fill",
                fill,
                "text",
                false,
                relatedPaints,
                4.5,
            );
        }

        if (!hasStroke || !this.markProcessed(element, "stroke")) return;

        if (backgroundHalo) {
            this.journal.setPaint(
                element,
                "stroke",
                this.options.darkBackground,
                stroke.source,
            );
            if (stroke.currentColor) this.report.currentColorResolutions += 1;
            this.report.backgroundHalos += 1;
            return;
        }

        this.mapAndWrite(
            element,
            "stroke",
            stroke,
            "text-outline",
            false,
            relatedPaints,
            3,
        );
    }

    private transformGraphic(element: SVGElement): void {
        for (const property of ["fill", "stroke"] as const) {
            if (!this.markProcessed(element, property)) continue;
            const paint = resolvePaint(element, property);
            if (property === 'fill' && isSvgBackdropRect(
                this.root,
                element,
                paint.color,
                this.options.sourceBackground,
                this.options.haloColorDistance,
                this.options.backdropMinCoverage,
            )) {
                this.journal.setPaint(
                    element,
                    property,
                    this.options.darkBackground,
                    paint.source,
                );
                if (paint.currentColor) this.report.currentColorResolutions += 1;
                this.report.backdrops += 1;
                continue;
            }
            const paintServerId = localPaintServerId(paint.raw);
            if (paintServerId) {
                this.transformPaintServer(paintServerId);
                continue;
            }
            if (!isSolidPaint(paint.color)) {
                this.report.skippedPaints += 1;
                continue;
            }

            if (this.mapAndWrite(element, property, paint, "graphic", true)) {
                this.report.graphicPaints += 1;
            }
        }
    }

    private transformPaintServer(id: string): void {
        const target = this.root.ownerDocument.getElementById(id);
        if (!target || !this.root.contains(target)) {
            this.report.skippedPaints += 1;
            return;
        }
        for (const stop of target.querySelectorAll<SVGStopElement>("stop")) {
            this.transformGradientStop(stop);
        }
    }

    private transformGradientStop(stop: SVGStopElement): void {
        if (!this.markProcessed(stop, "stop-color")) return;
        const paint = resolvePaint(stop, "stop-color");
        if (!isSolidPaint(paint.color)) {
            this.report.skippedPaints += 1;
            return;
        }

        if (this.mapAndWrite(stop, "stop-color", paint, "gradient-stop", true)) {
            this.report.gradientStops += 1;
        }
    }

    private isBackgroundHalo(stroke: string, paints: SvgRelatedPaints): boolean {
        if (paints.strokeWidth < this.options.haloMinStrokeWidth) return false;
        if (!colorsAreNear(
            stroke,
            this.options.sourceBackground,
            this.options.haloColorDistance,
        )) return false;

        // `paint-order: stroke` is a strong halo signal. A very thick background-
        // colored stroke is also a halo even under the default paint order.
        return strokePaintedBeforeFill(paints.paintOrder) ||
            paints.strokeWidth >= this.options.haloMinStrokeWidth * 2;
    }

    private mapAndWrite(
        element: SVGElement,
        property: SvgPaintProperty,
        paint: ReturnType<typeof resolvePaint>,
        role: SvgPaintRole,
        preserveHue: boolean,
        relatedPaints?: SvgRelatedPaints,
        minContrast?: number,
    ): boolean {
        const request: SvgColorRequest = {
            role,
            property,
            background: this.options.darkBackground,
            sourceBackground: this.options.sourceBackground,
            preserveHue,
            ...(minContrast === undefined ? {} : { minContrast }),
            ...(relatedPaints === undefined ? {} : { relatedPaints }),
        };
        const mapped = this.mapColor(paint.color, request);
        if (!mapped) {
            this.report.skippedPaints += 1;
            return false;
        }

        this.journal.setPaint(element, property, mapped, paint.source);
        if (paint.currentColor) this.report.currentColorResolutions += 1;
        return true;
    }

    private mapColor(color: string, request: SvgColorRequest): string {
        const canCache = !request.relatedPaints;
        const cacheKey = canCache
            // A chart color gets one palette mapping even when reused by fill
            // and stroke. Property-by-property inversion creates mismatched art.
            ? [request.role, request.background, color].join("\u0000")
            : "";
        if (canCache) {
            const cached = this.palette.get(cacheKey);
            if (cached !== undefined) return cached;
        }

        const mapped = this.options.colors.mapColor(color, request).trim();
        if (canCache && mapped) this.palette.set(cacheKey, mapped);
        return mapped;
    }

    private markProcessed(element: SVGElement, property: SvgPaintProperty): boolean {
        let properties = this.processed.get(element);
        if (!properties) {
            properties = new Set<SvgPaintProperty>();
            this.processed.set(element, properties);
        }
        if (properties.has(property)) return false;
        properties.add(property);
        return true;
    }
}

function normalizeOptions(options: SvgTransformOptions): NormalizedOptions {
    return {
        ...options,
        colors: options.colors ?? sharedSvgColorTransformer,
        sourceBackground: options.sourceBackground ?? DEFAULT_SOURCE_BACKGROUND,
        haloMinStrokeWidth:
            options.haloMinStrokeWidth ?? DEFAULT_HALO_MIN_STROKE_WIDTH,
        haloColorDistance:
            options.haloColorDistance ?? DEFAULT_HALO_COLOR_DISTANCE,
        backdropMinCoverage:
            options.backdropMinCoverage ?? DEFAULT_BACKDROP_MIN_COVERAGE,
    };
}
