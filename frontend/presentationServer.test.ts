import { beforeEach, afterEach, it, expect } from 'vitest';
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPresentationStore, presentationMiddleware } from './presentationServer';

let folder: string;
let file: string;
let server: Server;
let port: number;
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'presentation-store-'));
  file = join(folder, 'content.json');
  writeFileSync(
    file,
    JSON.stringify({ format: 'mind-harness-text', version: 1, savedAt: null, fields: {} })
  );
  const middleware = presentationMiddleware(file);
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    })
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  rmSync(folder, { recursive: true, force: true });
});
function call(method: string, payload?: unknown, origin: string | null = 'same') {
  return new Promise<{
    status: number;
    body: {
      fields: Record<string, string>;
      revision: string;
      savedAt: string | null;
      error?: string;
      current?: { fields: Record<string, string> };
    };
  }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/__presentation/content',
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(origin === null
            ? {}
            : { Origin: origin === 'same' ? 'http://127.0.0.1:' + port : origin }),
        },
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text) }));
      }
    );
    req.on('error', reject);
    req.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}
it('persists unicode and multiline changes to a real file and a newly opened store', async () => {
  const first = await call('GET');
  const fields = {
    'slide.example.title': '新的标题',
    'slide.example.notes': '第一行\n第二行',
    empty: '',
  };
  const saved = await call('PUT', { revision: first.body.revision, fields });
  expect(saved.status).toBe(200);
  expect(JSON.parse(readFileSync(file, 'utf8')).fields).toEqual(fields);
  expect(createPresentationStore(file).read().fields).toEqual(fields);
  expect((await call('GET')).body.fields).toEqual(fields);
  expect(saved.body.savedAt).toBeTypeOf('string');
});
it('rejects a second device writing an old revision without losing the first update', async () => {
  const first = await call('GET');
  await call('PUT', { revision: first.body.revision, fields: { title: '设备一' } });
  const conflict = await call('PUT', {
    revision: first.body.revision,
    fields: { title: '设备二' },
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.current?.fields).toEqual({ title: '设备一' });
  expect(createPresentationStore(file).read().fields).toEqual({ title: '设备一' });
});
it('detects manual file changes even when metadata was not changed', async () => {
  const first = await call('GET');
  writeFileSync(
    file,
    JSON.stringify({ format: 'mind-harness-text', version: 1, fields: { title: '文件直接修改' } })
  );
  expect((await call('PUT', { revision: first.body.revision, fields: {} })).status).toBe(409);
});
it.each(['https://other.example', null])(
  'rejects cross-origin or missing-origin writes (%s)',
  async origin => {
    const original = readFileSync(file, 'utf8');
    const first = await call('GET');
    expect(
      (await call('PUT', { revision: first.body.revision, fields: { title: '不应写入' } }, origin))
        .status
    ).toBe(403);
    expect(readFileSync(file, 'utf8')).toBe(original);
  }
);
it('rejects invalid values without changing the file', async () => {
  const original = readFileSync(file, 'utf8');
  const first = await call('GET');
  expect(
    (await call('PUT', { revision: first.body.revision, fields: { title: 123 } })).status
  ).toBe(400);
  expect(readFileSync(file, 'utf8')).toBe(original);
});
it('reports unreadable content instead of returning empty data or overwriting it', async () => {
  writeFileSync(file, '{broken');
  expect((await call('GET')).status).toBe(500);
  expect((await call('PUT', { revision: 'old', fields: {} })).status).toBe(500);
  expect(readFileSync(file, 'utf8')).toBe('{broken');
});
