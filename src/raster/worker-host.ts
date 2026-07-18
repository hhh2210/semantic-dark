import type {RasterWorkerRequest, RasterWorkerResponse} from './worker';

interface HostConnectMessage {
  type: 'semantic-dark-raster-connect';
}

interface HostReadyMessage {
  type: 'semantic-dark-raster-ready';
}

interface HostErrorMessage {
  type: 'semantic-dark-raster-error';
  message: string;
}

interface HostStopMessage {
  type: 'semantic-dark-raster-stop';
}

type HostRequest = RasterWorkerRequest | HostStopMessage;

function connect(event: MessageEvent<HostConnectMessage>): void {
  if (event.source !== window.parent ||
      event.data?.type !== 'semantic-dark-raster-connect' ||
      event.ports.length !== 1) return;
  window.removeEventListener('message', connect);

  const port = event.ports[0]!;
  let worker: Worker;
  try {
    worker = new Worker(chrome.runtime.getURL('raster-worker.js'), {
      name: 'semantic-dark-raster',
    });
  } catch (error) {
    postError(port, error);
    port.close();
    return;
  }

  const stop = (): void => {
    worker.terminate();
    port.close();
  };
  worker.onmessage = (workerEvent: MessageEvent<RasterWorkerResponse>) => {
    const response = workerEvent.data;
    port.postMessage(response, response.type === 'result' ? [response.buffer] : []);
  };
  worker.onerror = (workerEvent) => {
    workerEvent.preventDefault();
    postError(port, workerEvent.message || 'Raster worker failed');
    stop();
  };
  worker.onmessageerror = () => {
    postError(port, 'Raster worker returned an unreadable message');
    stop();
  };
  port.onmessage = (portEvent: MessageEvent<HostRequest>) => {
    const request = portEvent.data;
    if (request?.type === 'semantic-dark-raster-stop') {
      stop();
      return;
    }
    if (request?.type === 'recolor') worker.postMessage(request, [request.buffer]);
  };
  port.onmessageerror = () => {
    postError(port, 'Raster worker host received an unreadable message');
    stop();
  };
  port.start();
  const ready: HostReadyMessage = {type: 'semantic-dark-raster-ready'};
  port.postMessage(ready);
}

window.addEventListener('message', connect);

function postError(port: MessagePort, error: unknown): void {
  const response: HostErrorMessage = {
    type: 'semantic-dark-raster-error',
    message: error instanceof Error ? error.message : String(error),
  };
  port.postMessage(response);
}
