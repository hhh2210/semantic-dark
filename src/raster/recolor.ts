import {clipSrgb, srgb} from '../color';
import type {SrgbColor} from '../color';
import type {RGBAImage} from '../vision';

import {analyzeRasterPalette} from './analyze';
import {byteAt, copyRasterData, validateRasterImage} from './image';
import {isSourceEdge, mapPixelSoftly} from './pixel-map';
import {buildRolePalette} from './roles';
import type {
    RasterAbstainReason,
    RasterPaletteEntry,
    RasterRecolorOptions,
    RasterRecolorReport,
    RasterRecolorResult,
    RasterRole,
    ResolvedRasterOptions,
} from './types';

const DEFAULT_OPTIONS: Readonly<ResolvedRasterOptions> = {
    maxPixels: 1_000_000,
    maxAnalysisPixels: 65_536,
    paletteSize: 8,
    quantizationBits: 4,
    alphaThreshold: 8,
    minimumBackgroundShare: 0.35,
    minimumBorderShare: 0.55,
    assignmentSoftness: 0.085,
    edgeThreshold: 0.12,
};

/** Deterministically recolor a diagram-like RGBA buffer without DOM or Canvas IO. */
export function recolorRasterDiagram(
    image: RGBAImage,
    darkBackground: SrgbColor,
    options: RasterRecolorOptions = {},
): RasterRecolorResult {
    const resolved = resolveOptions(options);
    validateColor(darkBackground);
    const stride = validateRasterImage(image);
    const output = copyRasterData(image.data);
    const pixelCount = image.width * image.height;
    if (pixelCount > resolved.maxPixels) {
        return abstained(image, output, stride, pixelCount, 'pixel-budget');
    }

    const analysis = analyzeRasterPalette(image, stride, resolved);
    if (analysis.opaqueSampleWeight <= 0) {
        return abstained(
            image,
            output,
            stride,
            pixelCount,
            'no-opaque-pixels',
            analysis.sampledPixels,
        );
    }

    const targetBackground = clipSrgb(darkBackground);
    const rolePalette = buildRolePalette(analysis, targetBackground, resolved);
    if (!rolePalette) {
        return abstained(
            image,
            output,
            stride,
            pixelCount,
            'no-dominant-background',
            analysis.sampledPixels,
            analysis.opaqueSampleWeight,
        );
    }

    const rolePixels: Record<RasterRole, number> = {
        background: 0,
        text: 0,
        accent: 0,
    };
    const colorCache = new Map<string, SrgbColor>();
    let transparentPixels = 0;
    let recoloredPixels = 0;
    let edgePixels = 0;

    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const offset = y * stride + x * 4;
            const alphaByte = byteAt(image.data, offset + 3);
            if (alphaByte <= resolved.alphaThreshold) {
                transparentPixels += 1;
                continue;
            }

            const source = srgb(
                byteAt(image.data, offset) / 255,
                byteAt(image.data, offset + 1) / 255,
                byteAt(image.data, offset + 2) / 255,
            );
            const alpha = alphaByte / 255;
            const edge = isSourceEdge(
                image,
                stride,
                x,
                y,
                source,
                alpha,
                resolved.edgeThreshold,
            );
            const mapping = mapPixelSoftly(
                source,
                rolePalette.entries,
                targetBackground,
                resolved.assignmentSoftness,
                edge,
                colorCache,
            );
            output[offset] = Math.round(mapping.color.r * 255);
            output[offset + 1] = Math.round(mapping.color.g * 255);
            output[offset + 2] = Math.round(mapping.color.b * 255);
            output[offset + 3] = alphaByte;
            rolePixels[mapping.role] += 1;
            recoloredPixels += 1;
            if (edge) edgePixels += 1;
        }
    }

    const palette = rolePalette.entries.map<RasterPaletteEntry>((entry) => Object.freeze({
        source: entry.source,
        mapped: entry.mapped,
        role: entry.role,
        sampleWeight: entry.sampleWeight,
        sampleShare: entry.sampleShare,
        borderShare: entry.borderShare,
        primaryBackground: entry.primaryBackground,
    }));
    const report: RasterRecolorReport = Object.freeze({
        status: 'recolored',
        reason: null,
        pixelCount,
        sampledPixels: analysis.sampledPixels,
        opaqueSampleWeight: analysis.opaqueSampleWeight,
        transparentPixels,
        recoloredPixels,
        edgePixels,
        backgroundShare: rolePalette.backgroundShare,
        backgroundBorderShare: rolePalette.backgroundBorderShare,
        rolePixels: Object.freeze({...rolePixels}),
        palette: Object.freeze(palette),
    });
    return {data: output, width: image.width, height: image.height, stride, report};
}

function abstained(
    image: RGBAImage,
    output: Uint8ClampedArray,
    stride: number,
    pixelCount: number,
    reason: RasterAbstainReason,
    sampledPixels = 0,
    opaqueSampleWeight = 0,
): RasterRecolorResult {
    const report: RasterRecolorReport = Object.freeze({
        status: 'abstained',
        reason,
        pixelCount,
        sampledPixels,
        opaqueSampleWeight,
        transparentPixels: 0,
        recoloredPixels: 0,
        edgePixels: 0,
        backgroundShare: 0,
        backgroundBorderShare: 0,
        rolePixels: Object.freeze({background: 0, text: 0, accent: 0}),
        palette: Object.freeze([]),
    });
    return {data: output, width: image.width, height: image.height, stride, report};
}

function resolveOptions(options: RasterRecolorOptions): ResolvedRasterOptions {
    const resolved = {...DEFAULT_OPTIONS, ...options};
    assertInteger('maxPixels', resolved.maxPixels, 1);
    assertInteger('maxAnalysisPixels', resolved.maxAnalysisPixels, 1);
    assertInteger('paletteSize', resolved.paletteSize, 2, 16);
    assertInteger('quantizationBits', resolved.quantizationBits, 3, 6);
    assertInteger('alphaThreshold', resolved.alphaThreshold, 0, 254);
    assertRatio('minimumBackgroundShare', resolved.minimumBackgroundShare);
    assertRatio('minimumBorderShare', resolved.minimumBorderShare);
    assertRatio('edgeThreshold', resolved.edgeThreshold);
    if (!Number.isFinite(resolved.assignmentSoftness) ||
        resolved.assignmentSoftness <= 0 || resolved.assignmentSoftness > 1) {
        throw new RangeError('assignmentSoftness must be in (0, 1]');
    }
    return resolved;
}

function validateColor(color: SrgbColor): void {
    if (![color.r, color.g, color.b, color.a].every(Number.isFinite)) {
        throw new RangeError('darkBackground channels must be finite');
    }
}

function assertInteger(name: string, value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
    }
}

function assertRatio(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${name} must be a finite number in [0, 1]`);
    }
}
