import {readAuthorRuleProperty} from './css-cascade';
import type { PaintSource } from "./mutation-journal";
import type { SvgPaintProperty, SvgRelatedPaints } from "./types";

export interface ResolvedPaint {
    raw: string;
    color: string;
    source: PaintSource;
    currentColor: boolean;
}

const DEFAULT_VALUES: Readonly<Record<string, string>> = {
    color: "black",
    fill: "black",
    stroke: "none",
    "stop-color": "black",
    "stroke-width": "1",
    "paint-order": "normal",
};

const NAMED_RGB: Readonly<Record<string, readonly [number, number, number]>> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
};

export function readProperty(element: SVGElement, name: string): {
    raw: string;
    source: PaintSource;
} {
    const inline = element.style.getPropertyValue(name).trim();
    if (inline) return { raw: inline, source: "style" };

    const authorRule = readAuthorRuleProperty(element, name);
    const attribute = element.getAttribute(name)?.trim();
    const computed = readComputedProperty(element, name);

    // In a real browser computed style normally wins. jsdom reports SVG UA
    // defaults even when an author rule applies, so use CSSOM only in that case.
    if (authorRule) {
        if (computed && !isUaDefaultComputed(name, computed)) {
            return { raw: computed, source: "computed" };
        }
        return { raw: authorRule, source: "computed" };
    }

    if (attribute) return { raw: attribute, source: "attribute" };
    if (computed && !isUaDefaultComputed(name, computed)) {
        return { raw: computed, source: "computed" };
    }

    // jsdom and XML DOMs do not always expose inherited SVG presentation
    // attributes through getComputedStyle, so retain the platform semantics.
    let parent = element.parentElement;
    while (parent instanceof SVGElement) {
        const inheritedInline = parent.style.getPropertyValue(name).trim();
        if (inheritedInline) return { raw: inheritedInline, source: "computed" };
        const inheritedAttribute = parent.getAttribute(name)?.trim();
        if (inheritedAttribute) return { raw: inheritedAttribute, source: "computed" };
        parent = parent.parentElement;
    }

    if (computed) return { raw: computed, source: "computed" };
    return { raw: DEFAULT_VALUES[name] ?? "", source: "default" };
}

export function resolvePaint(
    element: SVGElement,
    property: SvgPaintProperty,
): ResolvedPaint {
    const resolved = readProperty(element, property);
    const currentColor = resolved.raw.trim().toLowerCase() === "currentcolor";
    return {
        ...resolved,
        color: currentColor ? resolveCurrentColor(element) : resolved.raw,
        currentColor,
    };
}

export function readRelatedPaints(element: SVGElement): SvgRelatedPaints {
    const fill = resolvePaint(element, "fill");
    const stroke = resolvePaint(element, "stroke");
    const paintOrder = readProperty(element, "paint-order").raw || "normal";
    const strokeWidth = parseSvgLength(readProperty(element, "stroke-width").raw);
    return {
        fill: isSolidPaint(fill.color) ? fill.color : null,
        stroke: isSolidPaint(stroke.color) ? stroke.color : null,
        paintOrder,
        strokeWidth,
    };
}

export function isSolidPaint(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) &&
        normalized !== "none" &&
        normalized !== "transparent" &&
        normalized !== "context-fill" &&
        normalized !== "context-stroke" &&
        !normalized.startsWith("url(") &&
        !normalized.startsWith("var(");
}

export function localPaintServerId(value: string): string | null {
    const match = value.trim().match(/^url\(\s*["']?#([^\s"')]+)["']?\s*\)$/i);
    return match?.[1] ?? null;
}

export function parseSvgLength(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function strokePaintedBeforeFill(paintOrder: string): boolean {
    type PaintOrderPart = "fill" | "stroke" | "markers";
    const normalized = paintOrder.trim().toLowerCase();
    if (!normalized || normalized === "normal") return false;

    const declared = normalized.split(/[\s,]+/).filter((part): part is PaintOrderPart =>
        part === "fill" || part === "stroke" || part === "markers"
    );
    const complete = [...declared];
    for (const part of ["fill", "stroke", "markers"] as const) {
        if (!complete.includes(part)) complete.push(part);
    }
    return complete.indexOf("stroke") < complete.indexOf("fill");
}

export function colorsAreNear(
    first: string,
    second: string,
    maximumDistance: number,
): boolean {
    const a = parseCssRgb(first);
    const b = parseCssRgb(second);
    if (!a || !b) {
        return normalizeComparableColor(first) === normalizeComparableColor(second);
    }
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return distance <= maximumDistance;
}

function resolveCurrentColor(element: SVGElement): string {
    let current: Element | null = element;
    while (current instanceof SVGElement) {
        const inline = current.style.getPropertyValue("color").trim();
        if (inline && inline.toLowerCase() !== "currentcolor") return inline;

        const authorRule = readAuthorRuleProperty(current, 'color');
        if (authorRule && authorRule.toLowerCase() !== 'currentcolor') return authorRule;

        const attribute = current.getAttribute("color")?.trim();
        if (attribute && attribute.toLowerCase() !== "currentcolor") return attribute;
        current = current.parentElement;
    }

    const computed = readComputedProperty(element, 'color');
    if (computed &&
        computed.toLowerCase() !== 'currentcolor' &&
        !isUaDefaultComputed('color', computed)) {
        return computed;
    }
    return DEFAULT_VALUES.color ?? "black";
}

function readComputedProperty(element: SVGElement, name: string): string {
    try {
        return element.ownerDocument.defaultView
            ?.getComputedStyle(element)
            .getPropertyValue(name)
            .trim() ?? "";
    } catch {
        return "";
    }
}

function isUaDefaultComputed(name: string, value: string): boolean {
    const normalized = value.trim().toLowerCase().replaceAll(/\s+/g, '');
    switch (name) {
        case 'fill':
        case 'stop-color':
            return normalized === 'black' || normalized === 'rgb(0,0,0)';
        case 'stroke':
            return normalized === 'none' ||
                normalized === 'transparent' ||
                normalized === 'rgba(0,0,0,0)';
        case 'stroke-width':
            return normalized === '1' || normalized === '1px';
        case 'paint-order':
            return normalized === 'normal';
        case 'color':
            return normalized === 'canvastext' ||
                normalized === 'black' ||
                normalized === 'rgb(0,0,0)';
        default:
            return false;
    }
}

function normalizeComparableColor(value: string): string {
    return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

function parseCssRgb(value: string): readonly [number, number, number] | null {
    const normalized = value.trim().toLowerCase();
    if (normalized in NAMED_RGB) return NAMED_RGB[normalized] ?? null;

    if (normalized.startsWith("#")) {
        const hex = normalized.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            return [
                Number.parseInt(hex.charAt(0).repeat(2), 16),
                Number.parseInt(hex.charAt(1).repeat(2), 16),
                Number.parseInt(hex.charAt(2).repeat(2), 16),
            ];
        }
        if (hex.length === 6 || hex.length === 8) {
            return [
                Number.parseInt(hex.slice(0, 2), 16),
                Number.parseInt(hex.slice(2, 4), 16),
                Number.parseInt(hex.slice(4, 6), 16),
            ];
        }
        return null;
    }

    const rgb = normalized.match(/^rgba?\((.+)\)$/);
    if (!rgb) return null;
    const body = rgb[1];
    if (!body) return null;
    const channels = body
        .split(/[\s,\/]+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((channel) => channel.endsWith("%")
            ? Number.parseFloat(channel) * 2.55
            : Number.parseFloat(channel));
    if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
        return null;
    }
    return channels.map((channel) => Math.max(0, Math.min(255, channel))) as [
        number,
        number,
        number,
    ];
}
