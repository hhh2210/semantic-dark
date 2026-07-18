import type {RasterWorkerResponse} from '../raster/worker';

interface HostReadyMessage {
  type: 'semantic-dark-raster-ready';
}

interface HostErrorMessage {
  type: 'semantic-dark-raster-error';
  message: string;
}

type HostMessage = HostReadyMessage | HostErrorMessage | RasterWorkerResponse;

/** Bridges the isolated content world to a dedicated worker in extension origin. */
export function createHostedRasterWorker(hostUrl: string, timeoutMs: number): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const container = document.createElement('span');
    container.hidden = true;
    const shadow = container.attachShadow({mode: 'closed'});
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = hostUrl;
    shadow.append(iframe);

    const channel = new MessageChannel();
    const port = channel.port1;
    let ready = false;
    let stopped = false;
    const transport = createTransport(port, container, hostUrl, () => {
      stopped = true;
    });
    const timer = setTimeout(() => fail(
      new Error(`Raster worker host timed out after ${timeoutMs}ms`),
    ), timeoutMs);

    function fail(error: Error): void {
      if (ready || stopped) return;
      stopped = true;
      clearTimeout(timer);
      port.close();
      channel.port2.close();
      container.remove();
      reject(error);
    }

    port.onmessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message?.type === 'semantic-dark-raster-ready') {
        if (stopped) return;
        ready = true;
        clearTimeout(timer);
        resolve(transport);
        return;
      }
      if (message?.type === 'semantic-dark-raster-error') {
        if (!ready) fail(new Error(message.message));
        else emitError(transport, hostUrl, message.message);
        return;
      }
      if (ready) transport.onmessage?.call(transport, event as MessageEvent);
    };
    port.onmessageerror = (event) => {
      if (!ready) fail(new Error('Raster worker host returned an unreadable message'));
      else transport.onmessageerror?.call(transport, event);
    };
    iframe.addEventListener('error', () => fail(new Error('Raster worker host failed to load')), {
      once: true,
    });
    iframe.addEventListener('load', () => {
      const target = iframe.contentWindow;
      if (!target) {
        fail(new Error('Raster worker host has no content window'));
        return;
      }
      target.postMessage(
        {type: 'semantic-dark-raster-connect'},
        new URL(hostUrl).origin,
        [channel.port2],
      );
    }, {once: true});
    document.documentElement.append(container);
    port.start();
  });
}

function createTransport(
  port: MessagePort,
  container: HTMLElement,
  hostUrl: string,
  onStop: () => void,
): Worker {
  const transport = {
    onmessage: null,
    onmessageerror: null,
    onerror: null,
    postMessage(message: unknown, transfer: Transferable[] = []): void {
      port.postMessage(message, transfer);
    },
    terminate(): void {
      onStop();
      try {
        port.postMessage({type: 'semantic-dark-raster-stop'});
      } finally {
        port.close();
        container.remove();
      }
    },
  } as unknown as Worker;
  Object.defineProperty(transport, 'url', {value: hostUrl});
  return transport;
}

function emitError(transport: Worker, url: string, message: string): void {
  const event = new ErrorEvent('error', {message, filename: url, error: new Error(message)});
  transport.onerror?.(event);
}
