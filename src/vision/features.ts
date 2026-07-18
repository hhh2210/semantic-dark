import type {RGBAImage, VisionFeatureOptions, VisionFeatures} from './types';

const DEFAULT_MAX_SAMPLES = 4096;
const DEFAULT_ALPHA_THRESHOLD = 16;
const DEFAULT_EDGE_THRESHOLD = 0.12;
const DEFAULT_COLOR_BITS = 4;
const DEFAULT_DARK_THRESHOLD = 0.2;
const DEFAULT_LIGHT_THRESHOLD = 0.75;
const DEFAULT_SATURATED_THRESHOLD = 0.5;

interface ResolvedOptions {
    maxSamples: number;
    alphaThreshold: number;
    edgeThreshold: number;
    colorBits: number;
    darkLuminanceThreshold: number;
    lightLuminanceThreshold: number;
    saturatedThreshold: number;
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

function resolveOptions(options: VisionFeatureOptions): ResolvedOptions {
    const resolved: ResolvedOptions = {
        maxSamples: options.maxSamples ?? DEFAULT_MAX_SAMPLES,
        alphaThreshold: options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD,
        edgeThreshold: options.edgeThreshold ?? DEFAULT_EDGE_THRESHOLD,
        colorBits: options.colorBits ?? DEFAULT_COLOR_BITS,
        darkLuminanceThreshold: options.darkLuminanceThreshold ?? DEFAULT_DARK_THRESHOLD,
        lightLuminanceThreshold: options.lightLuminanceThreshold ?? DEFAULT_LIGHT_THRESHOLD,
        saturatedThreshold: options.saturatedThreshold ?? DEFAULT_SATURATED_THRESHOLD,
    };

    assertInteger('maxSamples', resolved.maxSamples, 1);
    assertInteger('alphaThreshold', resolved.alphaThreshold, 0, 255);
    assertInteger('colorBits', resolved.colorBits, 1, 8);
    assertRatio('edgeThreshold', resolved.edgeThreshold);
    assertRatio('darkLuminanceThreshold', resolved.darkLuminanceThreshold);
    assertRatio('lightLuminanceThreshold', resolved.lightLuminanceThreshold);
    assertRatio('saturatedThreshold', resolved.saturatedThreshold);
    if (resolved.darkLuminanceThreshold >= resolved.lightLuminanceThreshold) {
        throw new RangeError('darkLuminanceThreshold must be below lightLuminanceThreshold');
    }
    return resolved;
}

function validateImage(image: RGBAImage): number {
    assertInteger('width', image.width, 1);
    assertInteger('height', image.height, 1);
    const stride = image.stride ?? image.width * 4;
    assertInteger('stride', stride, image.width * 4);
    const requiredLength = (image.height - 1) * stride + image.width * 4;
    if (image.data.length < requiredLength) {
        throw new RangeError(`RGBA data is too short: expected at least ${requiredLength} bytes`);
    }
    return stride;
}

function srgbChannelToLinear(value: number): number {
    const normalized = value / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red: number, green: number, blue: number): number {
    return 0.2126 * srgbChannelToLinear(red) +
        0.7152 * srgbChannelToLinear(green) +
        0.0722 * srgbChannelToLinear(blue);
}

function hsvSaturation(red: number, green: number, blue: number): number {
    const maximum = Math.max(red, green, blue);
    if (maximum === 0) {
        return 0;
    }
    return (maximum - Math.min(red, green, blue)) / maximum;
}

function sampleGrid(width: number, height: number, maxSamples: number): [number, number] {
    if (width * height <= maxSamples) {
        return [width, height];
    }
    const aspectRatio = width / height;
    let gridWidth = Math.min(width, Math.max(1, Math.floor(Math.sqrt(maxSamples * aspectRatio))));
    let gridHeight = Math.min(height, Math.max(1, Math.floor(maxSamples / gridWidth)));
    gridWidth = Math.min(gridWidth, Math.max(1, Math.floor(maxSamples / gridHeight)));
    return [gridWidth, gridHeight];
}

function normalizedEntropy(histogram: Map<number, number>, count: number, maximumBuckets: number): number {
    if (count <= 1 || histogram.size <= 1) {
        return 0;
    }
    let entropy = 0;
    for (const bucketCount of histogram.values()) {
        const probability = bucketCount / count;
        entropy -= probability * Math.log2(probability);
    }
    const possibleEntropy = Math.log2(Math.min(count, maximumBuckets));
    return possibleEntropy === 0 ? 0 : entropy / possibleEntropy;
}

/** Extract bounded-cost visual statistics from an RGBA8 image. */
export function extractVisionFeatures(
    image: RGBAImage,
    options: VisionFeatureOptions = {},
): VisionFeatures {
    const stride = validateImage(image);
    const resolved = resolveOptions(options);
    const [gridWidth, gridHeight] = sampleGrid(image.width, image.height, resolved.maxSamples);
    const sampleCount = gridWidth * gridHeight;
    const luminances = new Float64Array(sampleCount);
    const alphas = new Float64Array(sampleCount);
    const histogram = new Map<number, number>();
    const quantizeShift = 8 - resolved.colorBits;
    const maximumBuckets = 2 ** (resolved.colorBits * 3);

    let alphaSum = 0;
    let transparentCount = 0;
    let translucentCount = 0;
    let opaqueCount = 0;
    let luminanceSum = 0;
    let luminanceSquaredSum = 0;
    let minLuminance = 1;
    let maxLuminance = 0;
    let darkCount = 0;
    let lightCount = 0;
    let saturationSum = 0;
    let saturationSquaredSum = 0;
    let saturatedCount = 0;

    for (let gridY = 0; gridY < gridHeight; gridY++) {
        const sourceY = Math.min(image.height - 1, Math.floor((gridY + 0.5) * image.height / gridHeight));
        for (let gridX = 0; gridX < gridWidth; gridX++) {
            const sourceX = Math.min(image.width - 1, Math.floor((gridX + 0.5) * image.width / gridWidth));
            const offset = sourceY * stride + sourceX * 4;
            const red = image.data[offset] ?? 0;
            const green = image.data[offset + 1] ?? 0;
            const blue = image.data[offset + 2] ?? 0;
            const alphaByte = image.data[offset + 3] ?? 0;
            const alpha = alphaByte / 255;
            const sampleIndex = gridY * gridWidth + gridX;
            alphaSum += alpha;
            alphas[sampleIndex] = alpha;

            if (alphaByte <= resolved.alphaThreshold) {
                transparentCount++;
                continue;
            }
            if (alphaByte < 255 - resolved.alphaThreshold) {
                translucentCount++;
            }

            const luminance = relativeLuminance(red, green, blue);
            const saturation = hsvSaturation(red, green, blue);
            luminances[sampleIndex] = luminance;
            opaqueCount++;
            luminanceSum += luminance;
            luminanceSquaredSum += luminance * luminance;
            saturationSum += saturation;
            saturationSquaredSum += saturation * saturation;
            minLuminance = Math.min(minLuminance, luminance);
            maxLuminance = Math.max(maxLuminance, luminance);
            if (luminance <= resolved.darkLuminanceThreshold) {
                darkCount++;
            }
            if (luminance >= resolved.lightLuminanceThreshold) {
                lightCount++;
            }
            if (saturation >= resolved.saturatedThreshold) {
                saturatedCount++;
            }

            const bucket = ((red >> quantizeShift) << (resolved.colorBits * 2)) |
                ((green >> quantizeShift) << resolved.colorBits) |
                (blue >> quantizeShift);
            histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
        }
    }

    let edgeCount = 0;
    let edgePairCount = 0;
    const inspectEdge = (first: number, second: number) => {
        const firstAlpha = alphas[first]!;
        const secondAlpha = alphas[second]!;
        if (Math.max(firstAlpha, secondAlpha) <= resolved.alphaThreshold / 255) {
            return;
        }
        edgePairCount++;
        const alphaEdge = Math.abs(firstAlpha - secondAlpha) >= 0.25;
        const luminanceEdge = firstAlpha > resolved.alphaThreshold / 255 &&
            secondAlpha > resolved.alphaThreshold / 255 &&
            Math.abs(luminances[first]! - luminances[second]!) >= resolved.edgeThreshold;
        if (alphaEdge || luminanceEdge) {
            edgeCount++;
        }
    };

    for (let gridY = 0; gridY < gridHeight; gridY++) {
        for (let gridX = 0; gridX < gridWidth; gridX++) {
            const index = gridY * gridWidth + gridX;
            if (gridX + 1 < gridWidth) {
                inspectEdge(index, index + 1);
            }
            if (gridY + 1 < gridHeight) {
                inspectEdge(index, index + gridWidth);
            }
        }
    }

    const meanLuminance = opaqueCount === 0 ? 0 : luminanceSum / opaqueCount;
    const meanSaturation = opaqueCount === 0 ? 0 : saturationSum / opaqueCount;
    const luminanceVariance = opaqueCount === 0
        ? 0
        : Math.max(0, luminanceSquaredSum / opaqueCount - meanLuminance ** 2);
    const saturationVariance = opaqueCount === 0
        ? 0
        : Math.max(0, saturationSquaredSum / opaqueCount - meanSaturation ** 2);

    return {
        width: image.width,
        height: image.height,
        pixelCount: image.width * image.height,
        sampledPixelCount: sampleCount,
        opaqueSampleCount: opaqueCount,
        alphaRatio: alphaSum / sampleCount,
        transparentRatio: transparentCount / sampleCount,
        translucentRatio: translucentCount / sampleCount,
        meanLuminance,
        luminanceStdDev: Math.sqrt(luminanceVariance),
        minLuminance: opaqueCount === 0 ? 0 : minLuminance,
        maxLuminance: opaqueCount === 0 ? 0 : maxLuminance,
        darkPixelRatio: opaqueCount === 0 ? 0 : darkCount / opaqueCount,
        lightPixelRatio: opaqueCount === 0 ? 0 : lightCount / opaqueCount,
        meanSaturation,
        saturationStdDev: Math.sqrt(saturationVariance),
        saturatedPixelRatio: opaqueCount === 0 ? 0 : saturatedCount / opaqueCount,
        colorBucketCount: histogram.size,
        colorBucketRatio: opaqueCount === 0 ? 0 : histogram.size / Math.min(opaqueCount, maximumBuckets),
        colorEntropy: normalizedEntropy(histogram, opaqueCount, maximumBuckets),
        edgeDensity: edgePairCount === 0 ? 0 : edgeCount / edgePairCount,
    };
}
