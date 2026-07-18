import {extractVisionFeatures, type RGBAImage, type VisionFeatures} from '../../../vision';

export const FEATURE_NAMES = [
  'log_aspect_ratio',
  'log_pixel_count',
  'opaque_sample_ratio',
  'alpha_ratio',
  'transparent_ratio',
  'translucent_ratio',
  'mean_luminance',
  'luminance_std_dev',
  'min_luminance',
  'max_luminance',
  'luminance_range',
  'dark_pixel_ratio',
  'light_pixel_ratio',
  'mean_saturation',
  'saturation_std_dev',
  'saturated_pixel_ratio',
  'log_color_bucket_count',
  'color_bucket_ratio',
  'color_entropy',
  'edge_density',
] as const;

export function imageFeatureVector(image: RGBAImage): number[] {
  return projectVisionFeatures(extractVisionFeatures(image, {maxSamples: 4096}));
}

export function projectVisionFeatures(features: VisionFeatures): number[] {
  const values = [
    Math.log(features.width / features.height),
    Math.log1p(features.pixelCount),
    ratio(features.opaqueSampleCount, features.sampledPixelCount),
    features.alphaRatio,
    features.transparentRatio,
    features.translucentRatio,
    features.meanLuminance,
    features.luminanceStdDev,
    features.minLuminance,
    features.maxLuminance,
    features.maxLuminance - features.minLuminance,
    features.darkPixelRatio,
    features.lightPixelRatio,
    features.meanSaturation,
    features.saturationStdDev,
    features.saturatedPixelRatio,
    Math.log1p(features.colorBucketCount),
    features.colorBucketRatio,
    features.colorEntropy,
    features.edgeDensity,
  ];
  if (values.length !== FEATURE_NAMES.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Feature projection produced an invalid vector');
  }
  return values;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
