export const PRESENTATION_DRAFT_KEY = 'mind-harness.presentation.v2.text-edits';
export type PresentationFields = Record<string, string>;

export function decodePresentationDraft(text: string): PresentationFields {
  const data: unknown = JSON.parse(text);
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data) ||
    !('format' in data) ||
    data.format !== 'mind-harness-text' ||
    !('version' in data) ||
    data.version !== 1 ||
    !('fields' in data) ||
    typeof data.fields !== 'object' ||
    data.fields === null ||
    Array.isArray(data.fields) ||
    !Object.values(data.fields).every(value => typeof value === 'string')
  )
    throw new Error('这不是有效的 Mind Harness 文字备份。');
  return Object.fromEntries(Object.entries(data.fields)) as PresentationFields;
}

export function encodePresentationDraft(fields: PresentationFields): string {
  return JSON.stringify({ format: 'mind-harness-text', version: 1, fields }, null, 2);
}

export function readPresentationDraft(storage: Pick<Storage, 'getItem'>): PresentationFields {
  const raw = storage.getItem(PRESENTATION_DRAFT_KEY);
  return raw === null ? {} : decodePresentationDraft(raw);
}
