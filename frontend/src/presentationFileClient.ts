import { decodePresentationDraft, type PresentationFields } from './presentationDraft';

export type PresentationFile = {
  fields: PresentationFields;
  revision: string;
  savedAt: string | null;
  writable: boolean;
};
const ENDPOINT = '/__presentation/content';

function fileResponse(value: unknown): PresentationFile {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('revision' in value) ||
    typeof value.revision !== 'string' ||
    !('fields' in value)
  )
    throw new Error('服务器返回的内容格式无效。');
  const fields = decodePresentationDraft(
    JSON.stringify({ format: 'mind-harness-text', version: 1, fields: value.fields })
  );
  return {
    fields,
    revision: value.revision,
    savedAt: 'savedAt' in value && typeof value.savedAt === 'string' ? value.savedAt : null,
    writable: true,
  };
}
function errorMessage(value: unknown, fallback: string) {
  return typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : fallback;
}
async function request(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    const json = response.headers.get('content-type')?.includes('application/json') ?? false;
    const body: unknown = json ? await response.json() : null;
    return { response, json, body };
  } catch {
    throw new Error('无法连接演示保存服务，请保留当前修改并重试。');
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadPresentationFile(): Promise<PresentationFile> {
  const { response, json, body } = await request(ENDPOINT);
  if (response.ok && json) return fileResponse(body);
  if (response.status === 404 || response.status === 405 || (response.ok && !json)) {
    const snapshot = await request('/presentation-edits.json');
    if (!snapshot.response.ok || !snapshot.json) throw new Error('未找到演示内容文件或保存服务。');
    return {
      fields: decodePresentationDraft(JSON.stringify(snapshot.body)),
      revision: 'static',
      savedAt: null,
      writable: false,
    };
  }
  throw new Error(errorMessage(body, '读取演示内容文件失败。'));
}
export class PresentationWriteConflict extends Error {
  constructor(readonly current: PresentationFile) {
    super('其他设备已更新文件，请检查最新内容后重试。');
  }
}
export async function savePresentationFile(
  revision: string,
  fields: PresentationFields
): Promise<PresentationFile> {
  const { response, json, body } = await request(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, fields }),
  });
  if (response.status === 409 && typeof body === 'object' && body !== null && 'current' in body)
    throw new PresentationWriteConflict(fileResponse(body.current));
  if (!response.ok || !json)
    throw new Error(errorMessage(body, '保存未成功，修改仍留在编辑框中。'));
  return fileResponse(body);
}
