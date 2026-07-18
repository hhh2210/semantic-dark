import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';

export async function assertE2eInputs({chromePath, extensionDir, fixtureDir, routes}) {
  await access(chromePath);
  await access(path.join(extensionDir, 'manifest.json'));
  const fixtureFiles = new Set([...routes.values()].map(([filename]) => filename));
  await Promise.all([...fixtureFiles].map((filename) => access(path.join(fixtureDir, filename))));
}

export async function createFixtureServer({fixtureDir, routes}) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const route = routes.get(pathname);
      if (!route) {
        response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
        response.end('Not found');
        return;
      }

      const [filename, contentType] = route;
      const body = await readFile(path.join(fixtureDir, filename));
      response.writeHead(200, {
        'cache-control': 'no-store',
        // Prove the extension worker belongs to the isolated extension world,
        // rather than quietly relying on the host page's worker policy.
        'content-security-policy': "worker-src 'none'",
        'content-type': contentType,
        'content-length': body.byteLength,
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'});
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'Fixture server did not expose a TCP port');

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
