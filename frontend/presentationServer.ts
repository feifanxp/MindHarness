import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
type PresentationFields = Record<string, string>;
function validateFields(value: unknown): PresentationFields {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.values(value).every(text => typeof text === 'string')
  )
    throw new Error('Invalid presentation fields');
  return Object.fromEntries(Object.entries(value)) as PresentationFields;
}

export const PRESENTATION_ENDPOINT = '/__presentation/content';
export type PresentationSnapshot = {
  fields: PresentationFields;
  revision: string;
  savedAt: string | null;
};

export class PresentationConflict extends Error {
  constructor(readonly current: PresentationSnapshot) {
    super('文件已被其他页面修改，请重新检查后保存。');
  }
}

export function createPresentationStore(filePath: string) {
  const read = (): PresentationSnapshot => {
    const raw = readFileSync(filePath, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== 'object' ||
      data === null ||
      !('format' in data) ||
      data.format !== 'mind-harness-text' ||
      !('version' in data) ||
      data.version !== 1 ||
      !('fields' in data)
    )
      throw new Error('Invalid presentation document');
    const fields = validateFields(data.fields);
    const savedAt =
      typeof data === 'object' &&
      data !== null &&
      'savedAt' in data &&
      typeof data.savedAt === 'string'
        ? data.savedAt
        : null;
    return { fields, revision: createHash('sha256').update(raw).digest('hex'), savedAt };
  };
  const replace = (revision: string, fields: PresentationFields): PresentationSnapshot => {
    const current = read();
    if (current.revision !== revision) throw new PresentationConflict(current);
    const savedAt = new Date().toISOString();
    const raw =
      JSON.stringify({ format: 'mind-harness-text', version: 1, savedAt, fields }, null, 2) + '\n';
    const temporary = filePath + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, raw, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { fields, savedAt, revision: createHash('sha256').update(raw).digest('hex') };
  };
  return { read, replace };
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}
function sameOriginWrite(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || !request.headers.host) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const site = request.headers['sec-fetch-site'];
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.host === request.headers.host &&
    (site === undefined || site === 'same-origin')
  );
}

export function presentationMiddleware(filePath: string) {
  const store = createPresentationStore(filePath);
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== PRESENTATION_ENDPOINT) {
      next();
      return;
    }
    if (request.method === 'GET') {
      try {
        send(response, 200, store.read());
      } catch {
        send(response, 500, { error: '无法读取演示内容文件，未使用旧内容代替。' });
      }
      return;
    }
    if (request.method !== 'PUT') {
      send(response, 405, { error: '不支持此请求方法。' });
      return;
    }
    if (!sameOriginWrite(request)) {
      send(response, 403, { error: '请在演示网站内保存修改。' });
      return;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      send(response, 415, { error: '保存请求必须使用 JSON。' });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 2 * 1024 * 1024) chunks.push(chunk);
    });
    request.on('error', () => {
      if (!response.headersSent) send(response, 400, { error: '请求中断，修改未保存。' });
    });
    request.on('end', () => {
      if (size > 2 * 1024 * 1024) {
        send(response, 413, { error: '修改内容超过 2 MB，请减少单次保存的文字量。' });
        return;
      }
      let revision: string;
      let fields: PresentationFields;
      try {
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('revision' in payload) ||
          typeof payload.revision !== 'string' ||
          !('fields' in payload)
        )
          throw new Error('invalid');
        revision = payload.revision;
        fields = validateFields(payload.fields);
      } catch {
        send(response, 400, { error: '保存格式无效，文件没有变化。' });
        return;
      }
      try {
        send(response, 200, store.replace(revision, fields));
      } catch (error) {
        if (error instanceof PresentationConflict)
          send(response, 409, { error: error.message, current: error.current });
        else
          send(response, 500, {
            error: '写入文件失败，修改未确认保存，请保留编辑框中的文字并重试。',
          });
      }
    });
  };
}

export function presentationFiles(filePath: string): Plugin {
  return {
    name: 'mind-harness-presentation-files',
    configureServer(server) {
      server.middlewares.use(presentationMiddleware(filePath));
    },
    configurePreviewServer(server) {
      server.middlewares.use(presentationMiddleware(filePath));
    },
    generateBundle() {
      const document = createPresentationStore(filePath).read();
      this.emitFile({
        type: 'asset',
        fileName: 'presentation-edits.json',
        source: JSON.stringify(
          {
            format: 'mind-harness-text',
            version: 1,
            savedAt: document.savedAt,
            fields: document.fields,
          },
          null,
          2
        ),
      });
    },
  };
}
