import {colorsAreNear} from './paint';

interface SvgViewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Conservatively identifies an opaque rect used as the SVG canvas.
 * Transformed, clipped, masked, filtered, or translucent rects stay graphics.
 */
export function isSvgBackdropRect(
    root: SVGSVGElement,
    element: SVGElement,
    fill: string,
    sourceBackground: string,
    maximumColorDistance: number,
    minimumCoverage: number,
): boolean {
    if (element.localName.toLowerCase() !== 'rect') return false;
    if (!colorsAreNear(fill, sourceBackground, maximumColorDistance)) return false;
    if (hasNonBackdropEffects(root, element) || !isOpaquePaint(element, fill)) return false;

    const viewport = readViewport(root);
    if (!viewport) return false;
    const rect = readRect(element, viewport);
    if (!rect) return false;

    const left = Math.max(viewport.x, rect.x);
    const top = Math.max(viewport.y, rect.y);
    const right = Math.min(viewport.x + viewport.width, rect.x + rect.width);
    const bottom = Math.min(viewport.y + viewport.height, rect.y + rect.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const coverage = intersection / (viewport.width * viewport.height);
    return coverage + Number.EPSILON >= minimumCoverage;
}

function readViewport(root: SVGSVGElement): SvgViewport | null {
    const viewBox = root.getAttribute('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    if (viewBox?.length === 4) {
        const [x, y, width, height] = viewBox;
        if ([x, y, width, height].every(Number.isFinite) &&
            width !== undefined && width > 0 &&
            height !== undefined && height > 0) {
            return {x: x ?? 0, y: y ?? 0, width, height};
        }
    }

    const width = parseAbsoluteLength(root.getAttribute('width'));
    const height = parseAbsoluteLength(root.getAttribute('height'));
    if (width !== null && height !== null && width > 0 && height > 0) {
        return {x: 0, y: 0, width, height};
    }
    return null;
}

function readRect(element: SVGElement, viewport: SvgViewport): SvgViewport | null {
    const width = parseLength(element.getAttribute('width'), viewport.width, 0);
    const height = parseLength(element.getAttribute('height'), viewport.height, 0);
    if (width <= 0 || height <= 0) return null;
    return {
        x: parseLength(element.getAttribute('x'), viewport.width, 0, viewport.x),
        y: parseLength(element.getAttribute('y'), viewport.height, 0, viewport.y),
        width,
        height,
    };
}

function parseLength(
    value: string | null,
    extent: number,
    fallback: number,
    percentageOrigin = 0,
): number {
    if (value === null || !value.trim()) return fallback;
    const normalized = value.trim();
    if (normalized.endsWith('%')) {
        const percentage = Number.parseFloat(normalized);
        return Number.isFinite(percentage)
            ? percentageOrigin + extent * percentage / 100
            : fallback;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAbsoluteLength(value: string | null): number | null {
    if (!value || value.trim().endsWith('%')) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function hasNonBackdropEffects(root: SVGSVGElement, element: SVGElement): boolean {
    for (const property of ['clip-path', 'mask', 'filter']) {
        if (element.getAttribute(property) || element.style.getPropertyValue(property)) return true;
    }
    let current: SVGElement | null = element;
    while (current && current !== root) {
        const transform = current.getAttribute('transform') ??
            current.style.getPropertyValue('transform');
        if (transform && transform.trim().toLowerCase() !== 'none') return true;
        current = current.parentElement instanceof SVGElement ? current.parentElement : null;
    }
    return false;
}

function isOpaquePaint(element: SVGElement, fill: string): boolean {
    for (const property of ['opacity', 'fill-opacity']) {
        const raw = element.style.getPropertyValue(property) || element.getAttribute(property);
        if (raw !== null && raw !== '') {
            const opacity = Number.parseFloat(raw);
            if (!Number.isFinite(opacity) || opacity < 0.99) return false;
        }
    }

    const normalized = fill.trim().toLowerCase();
    if (/^#[\da-f]{4}$/i.test(normalized)) {
        return Number.parseInt(normalized.at(-1)!.repeat(2), 16) >= 252;
    }
    if (/^#[\da-f]{8}$/i.test(normalized)) {
        return Number.parseInt(normalized.slice(-2), 16) >= 252;
    }
    const alpha = normalized.match(/^rgba?\(.+(?:\/|,)\s*([\d.]+%?)\s*\)$/)?.[1];
    if (!alpha) return true;
    const parsed = Number.parseFloat(alpha);
    return Number.isFinite(parsed) && (alpha.endsWith('%') ? parsed >= 99 : parsed >= 0.99);
}
