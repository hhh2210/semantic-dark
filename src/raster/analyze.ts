import {srgb, srgbToOklab} from '../color';
import type {RGBAImage} from '../vision';

import {byteAt} from './image';
import type {RasterAnalysis, RasterCluster, ResolvedRasterOptions} from './types';

interface ColorBucket {
    weight: number;
    borderWeight: number;
    red: number;
    green: number;
    blue: number;
    color: ReturnType<typeof srgb>;
    lab: ReturnType<typeof srgbToOklab>;
}

interface Accumulator {
    weight: number;
    borderWeight: number;
    red: number;
    green: number;
    blue: number;
}

export function analyzeRasterPalette(
    image: RGBAImage,
    stride: number,
    options: ResolvedRasterOptions,
): RasterAnalysis {
    const histogram = new Map<number, Omit<ColorBucket, 'color' | 'lab'>>();
    const [gridWidth, gridHeight] = sampleGrid(
        image.width,
        image.height,
        options.maxAnalysisPixels,
    );
    const borderBand = Math.max(1, Math.ceil(Math.min(image.width, image.height) * 0.04));
    let sampledPixels = 0;
    let opaqueSampleWeight = 0;
    let borderSampleWeight = 0;

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
        const y = sampleCoordinate(gridY, gridHeight, image.height);
        for (let gridX = 0; gridX < gridWidth; gridX += 1) {
            const x = sampleCoordinate(gridX, gridWidth, image.width);
            sampledPixels += 1;
            const offset = y * stride + x * 4;
            const alphaByte = byteAt(image.data, offset + 3);
            if (alphaByte <= options.alphaThreshold) continue;

            const weight = alphaByte / 255;
            const red = byteAt(image.data, offset) / 255;
            const green = byteAt(image.data, offset + 1) / 255;
            const blue = byteAt(image.data, offset + 2) / 255;
            const border = x < borderBand || y < borderBand ||
                x >= image.width - borderBand || y >= image.height - borderBand;
            const borderWeight = border ? weight : 0;
            const key = quantizedKey(red, green, blue, options.quantizationBits);
            const bucket = histogram.get(key) ?? {
                weight: 0,
                borderWeight: 0,
                red: 0,
                green: 0,
                blue: 0,
            };
            bucket.weight += weight;
            bucket.borderWeight += borderWeight;
            bucket.red += red * weight;
            bucket.green += green * weight;
            bucket.blue += blue * weight;
            histogram.set(key, bucket);
            opaqueSampleWeight += weight;
            borderSampleWeight += borderWeight;
        }
    }

    const buckets = [...histogram.values()].map<ColorBucket>((bucket) => {
        const color = srgb(
            bucket.red / bucket.weight,
            bucket.green / bucket.weight,
            bucket.blue / bucket.weight,
        );
        return {...bucket, color, lab: srgbToOklab(color)};
    });
    const clusters = clusterBuckets(buckets, options.paletteSize);
    return {
        clusters,
        sampledPixels,
        opaqueSampleWeight,
        borderSampleWeight,
    };
}

function clusterBuckets(buckets: ColorBucket[], requestedCount: number): RasterCluster[] {
    if (buckets.length === 0) return [];
    const count = Math.min(requestedCount, buckets.length);
    const centers: ColorBucket[] = [];
    const ranked = [...buckets].sort((left, right) =>
        seedWeight(right) - seedWeight(left) || colorKey(left) - colorKey(right)
    );
    centers.push(ranked[0]!);

    while (centers.length < count) {
        let best: ColorBucket | null = null;
        let bestScore = -1;
        for (const bucket of buckets) {
            const distance = Math.min(...centers.map((center) =>
                labDistanceSquared(bucket.lab, center.lab)
            ));
            const score = seedWeight(bucket) * Math.max(distance, 1e-9);
            if (score > bestScore || score === bestScore && colorKey(bucket) < colorKey(best!)) {
                best = bucket;
                bestScore = score;
            }
        }
        if (!best || centers.includes(best)) break;
        centers.push(best);
    }

    let clusters = centers.map<RasterCluster>((center) => ({
        source: center.color,
        sourceLab: center.lab,
        sampleWeight: center.weight,
        borderWeight: center.borderWeight,
    }));

    for (let iteration = 0; iteration < 4; iteration += 1) {
        const accumulators = clusters.map<Accumulator>(() => ({
            weight: 0,
            borderWeight: 0,
            red: 0,
            green: 0,
            blue: 0,
        }));
        for (const bucket of buckets) {
            const index = nearestCluster(bucket.lab, clusters);
            const accumulator = accumulators[index]!;
            accumulator.weight += bucket.weight;
            accumulator.borderWeight += bucket.borderWeight;
            accumulator.red += bucket.color.r * bucket.weight;
            accumulator.green += bucket.color.g * bucket.weight;
            accumulator.blue += bucket.color.b * bucket.weight;
        }
        clusters = clusters.map((cluster, index) => {
            const accumulator = accumulators[index]!;
            if (accumulator.weight <= 0) {
                return {...cluster, sampleWeight: 0, borderWeight: 0};
            }
            const source = srgb(
                accumulator.red / accumulator.weight,
                accumulator.green / accumulator.weight,
                accumulator.blue / accumulator.weight,
            );
            return {
                source,
                sourceLab: srgbToOklab(source),
                sampleWeight: accumulator.weight,
                borderWeight: accumulator.borderWeight,
            };
        });
    }

    return clusters.filter((cluster) => cluster.sampleWeight > 0).sort((left, right) =>
        right.sampleWeight - left.sampleWeight ||
        colorKey({color: left.source}) - colorKey({color: right.source})
    );
}

function nearestCluster(
    lab: ReturnType<typeof srgbToOklab>,
    clusters: readonly RasterCluster[],
): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < clusters.length; index += 1) {
        const distance = labDistanceSquared(lab, clusters[index]!.sourceLab);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }
    return bestIndex;
}

function sampleGrid(width: number, height: number, maximum: number): [number, number] {
    if (width * height <= maximum) return [width, height];
    const aspect = width / height;
    let gridWidth = Math.min(width, Math.max(1, Math.floor(Math.sqrt(maximum * aspect))));
    let gridHeight = Math.min(height, Math.max(1, Math.floor(maximum / gridWidth)));
    gridWidth = Math.min(gridWidth, Math.max(1, Math.floor(maximum / gridHeight)));
    return [gridWidth, gridHeight];
}

function sampleCoordinate(index: number, count: number, extent: number): number {
    if (count <= 1) return Math.floor((extent - 1) / 2);
    return Math.round(index * (extent - 1) / (count - 1));
}

function quantizedKey(red: number, green: number, blue: number, bits: number): number {
    const levels = 2 ** bits;
    const r = Math.min(levels - 1, Math.floor(red * levels));
    const g = Math.min(levels - 1, Math.floor(green * levels));
    const b = Math.min(levels - 1, Math.floor(blue * levels));
    return (r << (bits * 2)) | (g << bits) | b;
}

function seedWeight(bucket: ColorBucket): number {
    return bucket.weight + bucket.borderWeight * 1.5;
}

function colorKey(bucket: Pick<ColorBucket, 'color'>): number {
    return Math.round(bucket.color.r * 255) * 65_536 +
        Math.round(bucket.color.g * 255) * 256 +
        Math.round(bucket.color.b * 255);
}

function labDistanceSquared(
    left: ReturnType<typeof srgbToOklab>,
    right: ReturnType<typeof srgbToOklab>,
): number {
    return (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;
}
