import {afterEach, describe, expect, it, vi} from 'vitest';

import {srgb} from '../../src/color';
import {
  RasterWorkerClient,
  RasterWorkerClientError,
} from '../../src/content/raster-worker-client';
import {recolorRasterDiagram} from '../../src/raster';
import type {
  RasterWorkerRecolorRequest,
  RasterWorkerResponse,
} from '../../src/raster/worker';
import {syntheticChart} from '../raster/helpers';

type Behavior = 'respond' | 'silent' | 'error';

class FakeRasterWorker {
  onmessage: ((event: MessageEvent<RasterWorkerResponse>) => void) | null = null;
  onerror: OnErrorEventHandler = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  transfer: Transferable[] = [];

  constructor(private readonly behavior: Behavior) {}

  postMessage(message: RasterWorkerRecolorRequest, transfer: Transferable[]): void {
    this.transfer = transfer;
    if (this.behavior === 'silent') return;
    queueMicrotask(() => {
      if (this.behavior === 'error') {
        this.onmessage?.({
          data: {type: 'error', id: message.id, message: 'synthetic worker failure'},
        } as MessageEvent<RasterWorkerResponse>);
        return;
      }
      const result = recolorRasterDiagram({
        data: new Uint8ClampedArray(message.buffer),
        width: message.width,
        height: message.height,
        stride: message.stride,
      }, message.darkBackground, {maxPixels: message.maxPixels});
      const buffer = result.data.buffer as ArrayBuffer;
      this.onmessage?.({
        data: {
          type: 'result',
          id: message.id,
          buffer,
          width: result.width,
          height: result.height,
          stride: result.stride,
          report: result.report,
          workerDurationMs: 12.5,
        },
      } as MessageEvent<RasterWorkerResponse>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const workerInput = () => {
  const image = syntheticChart();
  return {
    data: image.data,
    width: image.width,
    height: image.height,
    stride: image.width * 4,
    darkBackground: srgb(18 / 255, 18 / 255, 18 / 255),
    maxPixels: 1_000_000,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RasterWorkerClient', () => {
  it('uses a transferable input buffer and reconstructs the worker result', async () => {
    const fake = new FakeRasterWorker('respond');
    const client = new RasterWorkerClient({
      workerUrl: 'chrome-extension://test/raster-worker.js',
      workerFactory: () => fake as unknown as Worker,
    });

    const input = workerInput();
    const sourceBuffer = input.data.buffer;
    const output = await client.recolor(input);

    expect(fake.transfer).toEqual([sourceBuffer]);
    expect(output.report.status).toBe('recolored');
    expect(output.data).toBeInstanceOf(Uint8ClampedArray);
    expect(output.data).not.toEqual(input.data);
    expect(output.workerDurationMs).toBe(12.5);
    expect(output.dispatchDurationMs).toBeGreaterThanOrEqual(0);
    expect(output.wallDurationMs).toBeGreaterThanOrEqual(0);
    client.stop();
    expect(fake.terminated).toBe(true);
  });

  it('terminates and rejects pending work on timeout', async () => {
    vi.useFakeTimers();
    const fake = new FakeRasterWorker('silent');
    const client = new RasterWorkerClient({
      workerUrl: 'chrome-extension://test/raster-worker.js',
      timeoutMs: 20,
      workerFactory: () => fake as unknown as Worker,
    });

    const pending = client.recolor(workerInput());
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'RasterWorkerClientError',
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
    expect(fake.terminated).toBe(true);
  });

  it('cancels in-flight work on stop and lazily creates a fresh worker', async () => {
    const workers = [new FakeRasterWorker('silent'), new FakeRasterWorker('respond')];
    const client = new RasterWorkerClient({
      workerUrl: 'chrome-extension://test/raster-worker.js',
      workerFactory: () => workers.shift() as unknown as Worker,
    });

    const pending = client.recolor(workerInput());
    const rejection = expect(pending).rejects.toMatchObject({code: 'cancelled'});
    client.stop();
    await rejection;

    const output = await client.recolor(workerInput());
    expect(output.report.status).toBe('recolored');
    client.stop();
  });

  it('surfaces worker protocol errors without replacing the source on the main thread', async () => {
    const fake = new FakeRasterWorker('error');
    const client = new RasterWorkerClient({
      workerUrl: 'chrome-extension://test/raster-worker.js',
      workerFactory: () => fake as unknown as Worker,
    });

    await expect(client.recolor(workerInput())).rejects.toEqual(expect.objectContaining({
      name: RasterWorkerClientError.name,
      code: 'worker-error',
      message: 'synthetic worker failure',
    }));
    client.stop();
  });
});
