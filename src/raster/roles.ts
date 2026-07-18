import {
    clipSrgb,
    contrastRatio,
    mapRoleColor,
    srgbToOklab,
    srgbToOklch,
} from '../color';
import type {OklabColor, SrgbColor} from '../color';

import type {
    RasterAnalysis,
    RasterPaletteEntry,
    RasterRole,
    ResolvedRasterOptions,
} from './types';

export interface RuntimePaletteEntry extends RasterPaletteEntry {
    sourceLab: OklabColor;
    mappedLab: OklabColor;
}

export interface RolePalette {
    entries: RuntimePaletteEntry[];
    backgroundShare: number;
    backgroundBorderShare: number;
}

export function buildRolePalette(
    analysis: RasterAnalysis,
    darkBackground: SrgbColor,
    options: ResolvedRasterOptions,
): RolePalette | null {
    if (analysis.clusters.length === 0 || analysis.opaqueSampleWeight <= 0) return null;
    const backgroundIndex = chooseBackground(analysis);
    const backgroundCluster = analysis.clusters[backgroundIndex]!;
    const backgroundShare = backgroundCluster.sampleWeight / analysis.opaqueSampleWeight;
    const backgroundBorderShare = analysis.borderSampleWeight > 0
        ? backgroundCluster.borderWeight / analysis.borderSampleWeight
        : 0;
    const borderRescue = backgroundBorderShare >= options.minimumBorderShare &&
        backgroundShare >= options.minimumBackgroundShare * 0.5;
    if (backgroundShare < options.minimumBackgroundShare && !borderRescue) return null;

    const targetBackground = clipSrgb(darkBackground);
    const entries = analysis.clusters.map<RuntimePaletteEntry>((cluster, index) => {
        const primaryBackground = index === backgroundIndex;
        const role = primaryBackground
            ? 'background'
            : classifyRole(cluster.source, backgroundCluster.source);
        const mapped = mapRasterRoleColor(
            cluster.source,
            role,
            targetBackground,
            primaryBackground,
        );
        return {
            source: cluster.source,
            mapped,
            sourceLab: cluster.sourceLab,
            mappedLab: srgbToOklab(mapped),
            role,
            sampleWeight: cluster.sampleWeight,
            sampleShare: cluster.sampleWeight / analysis.opaqueSampleWeight,
            borderShare: analysis.borderSampleWeight > 0
                ? cluster.borderWeight / analysis.borderSampleWeight
                : 0,
            primaryBackground,
        };
    });
    return {entries, backgroundShare, backgroundBorderShare};
}

function chooseBackground(analysis: RasterAnalysis): number {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < analysis.clusters.length; index += 1) {
        const cluster = analysis.clusters[index]!;
        const share = cluster.sampleWeight / analysis.opaqueSampleWeight;
        const borderShare = analysis.borderSampleWeight > 0
            ? cluster.borderWeight / analysis.borderSampleWeight
            : 0;
        const score = share * 0.58 + borderShare * 0.42;
        if (score > bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    }
    return bestIndex;
}

function classifyRole(color: SrgbColor, sourceBackground: SrgbColor): RasterRole {
    const chroma = srgbToOklch(color).c;
    const backgroundDistance = labDistance(
        srgbToOklab(color),
        srgbToOklab(sourceBackground),
    );
    const sourceContrast = contrastRatio(color, sourceBackground);
    if (backgroundDistance <= 0.1 || sourceContrast < 1.7) return 'background';
    if (chroma <= 0.065) return 'text';
    return 'accent';
}

export function mapRasterRoleColor(
    color: SrgbColor,
    role: RasterRole,
    background: SrgbColor,
    primaryBackground = false,
): SrgbColor {
    if (primaryBackground) return background;
    switch (role) {
        case 'background':
            return mapRoleColor(color, {
                role: 'background',
                against: background,
                preserveHue: true,
                minContrast: 1,
            });
        case 'text':
            return mapRoleColor(color, {
                role: 'text',
                against: background,
                preserveHue: false,
                minContrast: 4.5,
            });
        case 'accent':
            return mapRoleColor(color, {
                role: 'accent',
                against: background,
                preserveHue: true,
                minContrast: 3,
            });
    }
}

function labDistance(left: OklabColor, right: OklabColor): number {
    return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}
