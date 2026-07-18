import type {SrgbColor} from '../color';
import type {RGBAImage} from '../vision';

export type RasterRole = 'background' | 'text' | 'accent';

export type RasterAbstainReason =
    | 'pixel-budget'
    | 'no-opaque-pixels'
    | 'no-dominant-background';

export interface RasterRecolorOptions {
    /** Hard bound on pixels read and rewritten. Larger inputs abstain unchanged. */
    maxPixels?: number;
    /** Deterministic analysis sample bound; recoloring still visits every pixel. */
    maxAnalysisPixels?: number;
    /** Number of deterministic color clusters, in [2, 16]. */
    paletteSize?: number;
    /** RGB histogram bits retained per channel, in [3, 6]. */
    quantizationBits?: number;
    /** Alpha values at or below this byte value are preserved untouched. */
    alphaThreshold?: number;
    /** Minimum global share for a dominant-background cluster. */
    minimumBackgroundShare?: number;
    /** Border support can rescue a background with lower global share. */
    minimumBorderShare?: number;
    /** OKLab soft-assignment width; edge pixels use a wider kernel. */
    assignmentSoftness?: number;
    /** Neighbor luminance delta counted as an edge. */
    edgeThreshold?: number;
}

export interface RasterPaletteEntry {
    source: SrgbColor;
    mapped: SrgbColor;
    role: RasterRole;
    sampleWeight: number;
    sampleShare: number;
    borderShare: number;
    primaryBackground: boolean;
}

export interface RasterRecolorReport {
    status: 'recolored' | 'abstained';
    reason: RasterAbstainReason | null;
    pixelCount: number;
    sampledPixels: number;
    opaqueSampleWeight: number;
    transparentPixels: number;
    recoloredPixels: number;
    edgePixels: number;
    backgroundShare: number;
    backgroundBorderShare: number;
    rolePixels: Readonly<Record<RasterRole, number>>;
    palette: readonly RasterPaletteEntry[];
}

export interface RasterRecolorResult extends Omit<RGBAImage, 'data' | 'stride'> {
    data: Uint8ClampedArray;
    stride: number;
    report: Readonly<RasterRecolorReport>;
}

export interface ResolvedRasterOptions {
    maxPixels: number;
    maxAnalysisPixels: number;
    paletteSize: number;
    quantizationBits: number;
    alphaThreshold: number;
    minimumBackgroundShare: number;
    minimumBorderShare: number;
    assignmentSoftness: number;
    edgeThreshold: number;
}

export interface RasterCluster {
    source: SrgbColor;
    sourceLab: {l: number; a: number; b: number; alpha: number};
    sampleWeight: number;
    borderWeight: number;
}

export interface RasterAnalysis {
    clusters: RasterCluster[];
    sampledPixels: number;
    opaqueSampleWeight: number;
    borderSampleWeight: number;
}
