import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const received: { cookie: string; method: string; path: string }[] = [];
const servers: Server[] = [];
let appOrigin: string;
let otherOrigin: string;

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/app/mindroom/computer/api.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const module = result.outputFiles[0].text;
  const start = async (): Promise<string> => {
    const server = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', appOrigin || '*');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return;
      }
      if (request.url === '/api.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(module);
        return;
      }
      if (!request.url?.startsWith('/api/computers/')) {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Computer API cookie test</title>');
        return;
      }
      received.push({
        cookie: request.headers.cookie || '',
        method: request.method || '',
        path: request.url,
      });
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'DELETE') {
        response.writeHead(204).end();
        return;
      }
      response.end(
        JSON.stringify({
          session_id: 'session-1',
          session_token: 'session-token',
          state: 'ready',
          mode: 'view',
          expires_at: 2_000_000_000,
          ticket: 'stream-ticket',
        })
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    return `http://127.0.0.1:${address.port}`;
  };
  appOrigin = await start();
  otherOrigin = await start();
});

test.afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
});

for (const sameOrigin of [true, false]) {
  test(`computer lifecycle ${
    sameOrigin ? 'preserves same-origin' : 'omits cross-origin'
  } cookies`, async ({ page, context }) => {
    received.length = 0;
    await context.addCookies([{ name: 'proxy_session', value: 'signed-in', url: appOrigin }]);
    await page.goto(appOrigin);
    await page.evaluate(
      async (apiUrl) => {
        const { createComputerSession } = await import('./api.js');
        const client = await createComputerSession({
          apiUrl,
          agentUserId: '@helper:example.org',
          roomId: '!room:example.org',
          openIdToken: {
            access_token: 'openid-token',
            token_type: 'Bearer',
            matrix_server_name: 'example.org',
            expires_in: 3600,
          },
        });
        await client.refreshStatus();
        await client.createStream();
        await client.control('take');
        await client.dispose();
      },
      sameOrigin ? appOrigin : otherOrigin
    );
    expect(received.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/computers/sessions',
      'GET /api/computers/sessions/session-1',
      'POST /api/computers/sessions/session-1/stream-ticket',
      'POST /api/computers/sessions/session-1/control',
      'DELETE /api/computers/sessions/session-1',
    ]);
    expect(received.map(({ cookie }) => cookie)).toEqual(
      Array(5).fill(sameOrigin ? 'proxy_session=signed-in' : '')
    );
  });
}
