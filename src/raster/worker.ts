import type {SrgbColor} from '../color';

import {recolorRasterDiagram} from './recolor';
import type {RasterRecolorReport} from './types';

export interface RasterWorkerRecolorRequest {
  type: 'recolor';
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  stride: number;
  darkBackground: SrgbColor;
  maxPixels: number;
}

export interface RasterWorkerResultResponse {
  type: 'result';
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  stride: number;
  report: Readonly<RasterRecolorReport>;
  workerDurationMs: number;
}

export interface RasterWorkerErrorResponse {
  type: 'error';
  id: number;
  message: string;
}

export type RasterWorkerRequest = RasterWorkerRecolorRequest;
export type RasterWorkerResponse = RasterWorkerResultResponse | RasterWorkerErrorResponse;

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<RasterWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== 'recolor') return;

  const startedAt = performance.now();
  try {
    const data = new Uint8ClampedArray(request.buffer);
    const result = recolorRasterDiagram({
      data,
      width: request.width,
      height: request.height,
      stride: request.stride,
    }, request.darkBackground, {maxPixels: request.maxPixels});
    const outputBuffer = result.data.buffer as ArrayBuffer;
    const response: RasterWorkerResultResponse = {
      type: 'result',
      id: request.id,
      buffer: outputBuffer,
      width: result.width,
      height: result.height,
      stride: result.stride,
      report: result.report,
      workerDurationMs: performance.now() - startedAt,
    };
    scope.postMessage(response, [outputBuffer]);
  } catch (error) {
    const response: RasterWorkerErrorResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
});
