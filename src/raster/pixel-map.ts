import {
    oklabToSrgb,
    relativeLuminance,
    srgb,
    srgbToOklab,
} from '../color';
import type {OklabColor, SrgbColor} from '../color';
import type {RGBAImage} from '../vision';

import {byteAt} from './image';
import {mapRasterRoleColor} from './roles';
import type {RuntimePaletteEntry} from './roles';
import type {RasterRole} from './types';

export interface PixelMapping {
    color: SrgbColor;
    role: RasterRole;
}

export function mapPixelSoftly(
    source: SrgbColor,
    palette: readonly RuntimePaletteEntry[],
    darkBackground: SrgbColor,
    softness: number,
    edge: boolean,
    cache: Map<string, SrgbColor>,
): PixelMapping {
    const sourceLab = srgbToOklab(source);
    const [first, second] = nearestTwo(sourceLab, palette);
    if (!second || first.entry.primaryBackground && first.distance <= 1e-10) {
        return {
            color: mapForEntry(source, first.entry, darkBackground, cache),
            role: first.entry.role,
        };
    }

    const sigma = softness * (edge ? 1.5 : 1);
    const denominator = Math.max(2 * sigma * sigma, 1e-9);
    const firstWeight = Math.exp(-first.distance / denominator);
    const secondWeight = Math.exp(-second.distance / denominator);
    const weightSum = firstWeight + secondWeight;
    if (!Number.isFinite(weightSum) || weightSum <= 1e-12) {
        return {
            color: mapForEntry(source, first.entry, darkBackground, cache),
            role: first.entry.role,
        };
    }

    const firstMapped = srgbToOklab(mapForEntry(source, first.entry, darkBackground, cache));
    const secondMapped = srgbToOklab(mapForEntry(source, second.entry, darkBackground, cache));
    const ratio = secondWeight / weightSum;
    return {
        color: oklabToSrgb(interpolateLab(firstMapped, secondMapped, ratio)),
        role: first.entry.role,
    };
}

export function isSourceEdge(
    image: RGBAImage,
    stride: number,
    x: number,
    y: number,
    source: SrgbColor,
    sourceAlpha: number,
    threshold: number,
): boolean {
    const luminance = relativeLuminance(source);
    for (const [nextX, nextY] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
    ] as const) {
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
        const offset = nextY * stride + nextX * 4;
        const alpha = byteAt(image.data, offset + 3) / 255;
        if (Math.abs(alpha - sourceAlpha) > 0.12) return true;
        const neighbor = srgb(
            byteAt(image.data, offset) / 255,
            byteAt(image.data, offset + 1) / 255,
            byteAt(image.data, offset + 2) / 255,
        );
        if (Math.abs(relativeLuminance(neighbor) - luminance) >= threshold) return true;
    }
    return false;
}

function mapForEntry(
    source: SrgbColor,
    entry: RuntimePaletteEntry,
    background: SrgbColor,
    cache: Map<string, SrgbColor>,
): SrgbColor {
    const rgbKey = Math.round(source.r * 255) * 65_536 +
        Math.round(source.g * 255) * 256 +
        Math.round(source.b * 255);
    const key = `${rgbKey}:${entry.role}:${entry.primaryBackground ? 1 : 0}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const mapped = mapRasterRoleColor(
        source,
        entry.role,
        background,
        entry.primaryBackground,
    );
    cache.set(key, mapped);
    return mapped;
}

function nearestTwo(
    source: OklabColor,
    palette: readonly RuntimePaletteEntry[],
): [
    {entry: RuntimePaletteEntry; distance: number},
    {entry: RuntimePaletteEntry; distance: number} | null,
] {
    let first: {entry: RuntimePaletteEntry; distance: number} | null = null;
    let second: {entry: RuntimePaletteEntry; distance: number} | null = null;
    for (const entry of palette) {
        const distance = distanceSquared(source, entry.sourceLab);
        const candidate = {entry, distance};
        if (!first || distance < first.distance) {
            second = first;
            first = candidate;
        } else if (!second || distance < second.distance) {
            second = candidate;
        }
    }
    return [first!, second];
}

function interpolateLab(first: OklabColor, second: OklabColor, ratio: number): OklabColor {
    return {
        l: first.l + (second.l - first.l) * ratio,
        a: first.a + (second.a - first.a) * ratio,
        b: first.b + (second.b - first.b) * ratio,
        alpha: 1,
    };
}

function distanceSquared(first: OklabColor, second: OklabColor): number {
    return (first.l - second.l) ** 2 +
        (first.a - second.a) ** 2 +
        (first.b - second.b) ** 2;
}
