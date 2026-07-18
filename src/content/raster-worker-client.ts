import type {SrgbColor} from '../color';
import type {RasterRecolorReport} from '../raster';
import type {
  RasterWorkerRecolorRequest,
  RasterWorkerResponse,
} from '../raster/worker';
import {createHostedRasterWorker} from './raster-worker-transport';

export type RasterWorkerFailureCode =
  | 'cancelled'
  | 'timeout'
  | 'unavailable'
  | 'worker-error';

export class RasterWorkerClientError extends Error {
  readonly code: RasterWorkerFailureCode;
  readonly dispatchDurationMs: number;

  constructor(code: RasterWorkerFailureCode, message: string, dispatchDurationMs = 0) {
    super(message);
    this.name = 'RasterWorkerClientError';
    this.code = code;
    this.dispatchDurationMs = dispatchDurationMs;
  }
}

export interface RasterWorkerInput {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  stride: number;
  darkBackground: SrgbColor;
  maxPixels: number;
}

export interface RasterWorkerOutput {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  stride: number;
  report: Readonly<RasterRecolorReport>;
  wallDurationMs: number;
  workerDurationMs: number;
  dispatchDurationMs: number;
}

export interface RasterWorkerClientOptions {
  workerUrl?: string;
  workerHostUrl?: string;
  timeoutMs?: number;
  workerFactory?: (url: string) => Worker | Promise<Worker>;
}

interface PendingRequest {
  resolve(output: RasterWorkerOutput): void;
  reject(error: RasterWorkerClientError): void;
  startedAt: number;
  dispatchDurationMs: number;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class RasterWorkerClient {
  private readonly workerUrl: string;
  private readonly workerHostUrl: string | undefined;
  private readonly timeoutMs: number;
  private readonly workerFactory: ((url: string) => Worker | Promise<Worker>) | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: Worker | null = null;
  private workerPromise: Promise<Worker> | null = null;
  private generation = 0;
  private nextId = 1;

  constructor(options: RasterWorkerClientOptions = {}) {
    this.workerUrl = options.workerUrl ?? chrome.runtime.getURL('raster-worker.js');
    this.workerHostUrl = options.workerHostUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workerFactory = options.workerFactory;
  }

  async recolor(input: RasterWorkerInput, signal?: AbortSignal): Promise<RasterWorkerOutput> {
    if (signal?.aborted) {
      throw new RasterWorkerClientError('cancelled', 'Raster worker request cancelled');
    }

    let worker: Worker;
    try {
      worker = await this.ensureWorker();
    } catch (error) {
      if (error instanceof RasterWorkerClientError) throw error;
      throw new RasterWorkerClientError(
        'unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (signal?.aborted) throw new RasterWorkerClientError('cancelled', 'Raster worker request cancelled');

    const id = this.nextId++;
    const buffer = transferableBuffer(input.data);
    const request: RasterWorkerRecolorRequest = {
      type: 'recolor',
      id,
      buffer,
      width: input.width,
      height: input.height,
      stride: input.stride,
      darkBackground: input.darkBackground,
      maxPixels: input.maxPixels,
    };

    return new Promise<RasterWorkerOutput>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        startedAt: performance.now(),
        dispatchDurationMs: 0,
        timer: setTimeout(() => {
          this.reset(new RasterWorkerClientError(
            'timeout',
            `Raster worker timed out after ${this.timeoutMs}ms`,
            pending.dispatchDurationMs,
          ));
        }, this.timeoutMs),
        ...(signal === undefined ? {} : {signal}),
      };
      if (signal) {
        pending.abortListener = () => this.reset(new RasterWorkerClientError(
          'cancelled',
          'Raster worker request cancelled',
          pending.dispatchDurationMs,
        ));
        signal.addEventListener('abort', pending.abortListener, {once: true});
      }
      this.pending.set(id, pending);

      const dispatchStartedAt = performance.now();
      try {
        worker.postMessage(request, [buffer]);
        pending.dispatchDurationMs = performance.now() - dispatchStartedAt;
      } catch (error) {
        pending.dispatchDurationMs = performance.now() - dispatchStartedAt;
        this.reset(new RasterWorkerClientError(
          'worker-error',
          error instanceof Error ? error.message : String(error),
          pending.dispatchDurationMs,
        ));
      }
    });
  }

  stop(): void {
    this.reset(new RasterWorkerClientError('cancelled', 'Raster worker stopped'));
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.workerPromise) return this.workerPromise;
    const generation = this.generation;
    const pendingWorker = this.createWorker();
    this.workerPromise = pendingWorker;
    let worker: Worker;
    try {
      worker = await pendingWorker;
    } finally {
      if (this.workerPromise === pendingWorker) this.workerPromise = null;
    }
    if (generation !== this.generation) {
      worker.terminate();
      throw new RasterWorkerClientError('cancelled', 'Raster worker stopped during startup');
    }
    worker.onmessage = (event: MessageEvent<RasterWorkerResponse>) => this.receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.reset(new RasterWorkerClientError(
        'worker-error',
        event.message || 'Raster worker failed',
      ));
    };
    worker.onmessageerror = () => this.reset(new RasterWorkerClientError(
      'worker-error',
      'Raster worker returned an unreadable message',
    ));
    this.worker = worker;
    return worker;
  }

  private async createWorker(): Promise<Worker> {
    if (this.workerFactory) return this.workerFactory(this.workerUrl);
    return createHostedRasterWorker(
      this.workerHostUrl ?? chrome.runtime.getURL('raster-worker-host.html'),
      this.timeoutMs,
    );
  }

  private receive(response: RasterWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.finish(response.id, pending);
    if (response.type === 'error') {
      pending.reject(new RasterWorkerClientError(
        'worker-error',
        response.message,
        pending.dispatchDurationMs,
      ));
      return;
    }
    pending.resolve({
      data: new Uint8ClampedArray(response.buffer),
      width: response.width,
      height: response.height,
      stride: response.stride,
      report: response.report,
      wallDurationMs: performance.now() - pending.startedAt,
      workerDurationMs: response.workerDurationMs,
      dispatchDurationMs: pending.dispatchDurationMs,
    });
  }

  private finish(id: number, pending: PendingRequest): void {
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
  }

  private reset(error: RasterWorkerClientError): void {
    this.generation += 1;
    this.worker?.terminate();
    this.worker = null;
    this.workerPromise = null;
    for (const [id, pending] of this.pending) {
      this.finish(id, pending);
      pending.reject(new RasterWorkerClientError(
        error.code,
        error.message,
        pending.dispatchDurationMs || error.dispatchDurationMs,
      ));
    }
  }
}

function transferableBuffer(data: Uint8ClampedArray): ArrayBuffer {
  if (data.buffer instanceof ArrayBuffer &&
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer;
  }
  return new Uint8ClampedArray(data).buffer;
}
