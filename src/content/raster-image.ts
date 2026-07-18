import {DEFAULT_DARK_BACKGROUND, parseCssColor} from '../color';
import type {RasterRecolorReport} from '../raster';
import {
  RasterWorkerClient,
  RasterWorkerClientError,
  type RasterWorkerFailureCode,
} from './raster-worker-client';

export type RasterImageFailureReason =
  | 'canvas-unavailable'
  | 'encode-failed'
  | `worker-${Exclude<RasterWorkerFailureCode, 'cancelled'>}`;

export interface RasterImageTransform {
  blob: Blob | null;
  report: Readonly<RasterRecolorReport> | null;
  durationMs: number;
  mainThreadDurationMs: number;
  dispatchDurationMs: number;
  workerDurationMs: number;
  workerMode: 'dedicated';
  failureReason: RasterImageFailureReason | null;
}

/** Canvas adapter: DOM decode/encode stays local; pixel computation is transferred. */
export async function transformDiagramImage(
  image: HTMLImageElement,
  background: string,
  worker: RasterWorkerClient,
  signal?: AbortSignal,
  maxPixels = 1_000_000,
): Promise<RasterImageTransform | null> {
  const startedAt = performance.now();
  let mainThreadDurationMs = 0;
  assertActive(signal);

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0 || width * height > maxPixels) return null;

  const canvasStartedAt = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    mainThreadDurationMs += performance.now() - canvasStartedAt;
    return failureResult('canvas-unavailable', startedAt, mainThreadDurationMs);
  }
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  mainThreadDurationMs += performance.now() - canvasStartedAt;
  const darkBackground = parseCssColor(background) ?? DEFAULT_DARK_BACKGROUND;

  let result;
  try {
    result = await worker.recolor({
      data: pixels.data,
      width,
      height,
      stride: width * 4,
      darkBackground,
      maxPixels,
    }, signal);
  } catch (error) {
    if (signal?.aborted ||
        (error instanceof RasterWorkerClientError && error.code === 'cancelled')) {
      throw error;
    }
    const workerError = error instanceof RasterWorkerClientError
      ? error
      : new RasterWorkerClientError('worker-error', error instanceof Error ? error.message : String(error));
    mainThreadDurationMs += workerError.dispatchDurationMs;
    return failureResult(
      `worker-${workerError.code}` as RasterImageFailureReason,
      startedAt,
      mainThreadDurationMs,
      workerError.dispatchDurationMs,
    );
  }
  assertActive(signal);
  mainThreadDurationMs += result.dispatchDurationMs;

  if (result.report.status !== 'recolored') {
    return {
      blob: null,
      report: result.report,
      durationMs: performance.now() - startedAt,
      mainThreadDurationMs,
      dispatchDurationMs: result.dispatchDurationMs,
      workerDurationMs: result.workerDurationMs,
      workerMode: 'dedicated',
      failureReason: null,
    };
  }

  const renderStartedAt = performance.now();
  context.putImageData(new ImageData(result.data, width, height), 0, 0);
  const blobPromise = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  mainThreadDurationMs += performance.now() - renderStartedAt;
  const blob = await blobPromise;
  assertActive(signal);
  return {
    blob,
    report: result.report,
    durationMs: performance.now() - startedAt,
    mainThreadDurationMs,
    dispatchDurationMs: result.dispatchDurationMs,
    workerDurationMs: result.workerDurationMs,
    workerMode: 'dedicated',
    failureReason: blob ? null : 'encode-failed',
  };
}

function failureResult(
  failureReason: RasterImageFailureReason,
  startedAt: number,
  mainThreadDurationMs: number,
  dispatchDurationMs = 0,
): RasterImageTransform {
  return {
    blob: null,
    report: null,
    durationMs: performance.now() - startedAt,
    mainThreadDurationMs,
    dispatchDurationMs,
    workerDurationMs: 0,
    workerMode: 'dedicated',
    failureReason,
  };
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RasterWorkerClientError('cancelled', 'Raster image transform cancelled');
  }
}
