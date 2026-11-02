import { decodePresentationDraft, type PresentationFields } from './presentationDraft';
import type { PresentationFile } from './presentationFileClient';

export const PORTABLE_CONTENT_ID = 'mind-harness-content';

function contentElement(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>('script#' + PORTABLE_CONTENT_ID);
}
export function isPortablePresentation(): boolean {
  return contentElement() !== null;
}
export function encodePortableContent(fields: PresentationFields, savedAt: string | null): string {
  return JSON.stringify({ format: 'mind-harness-text', version: 1, savedAt, fields })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
export function readPortablePresentation(): PresentationFile | null {
  const element = contentElement();
  if (!element) return null;
  const raw = element.textContent ?? '';
  const fields = decodePresentationDraft(raw);
  const data: unknown = JSON.parse(raw);
  const savedAt =
    typeof data === 'object' &&
    data !== null &&
    'savedAt' in data &&
    typeof data.savedAt === 'string'
      ? data.savedAt
      : null;
  return {
    fields,
    revision: 'portable-' + (element.dataset.revision ?? '0'),
    savedAt,
    writable: true,
  };
}
export function writePortablePresentation(
  revision: string,
  fields: PresentationFields
): PresentationFile {
  const element = contentElement();
  const current = readPortablePresentation();
  if (!element || !current) throw new Error('当前页面不是独立 HTML。');
  if (revision !== current.revision) throw new Error('当前页面的内容已更新，请重新打开编辑框。');
  const savedAt = new Date().toISOString();
  element.textContent = encodePortableContent(fields, savedAt);
  element.dataset.revision = String(Number(element.dataset.revision ?? '0') + 1);
  return { fields, revision: 'portable-' + element.dataset.revision, savedAt, writable: true };
}
export function portableHtml(): string {
  if (!isPortablePresentation()) throw new Error('请使用独立 HTML 版本保存文件。');
  const copy = document.documentElement.cloneNode(true) as HTMLElement;
  const root = copy.querySelector('#root');
  if (!root) throw new Error('演示页面结构不完整，无法导出。');
  root.replaceChildren();
  const title = copy.querySelector('title');
  if (title) title.textContent = 'Mind Harness — 独立演示';
  return '<!doctype html>\n' + copy.outerHTML;
}
export function downloadPortablePresentation(): void {
  const url = URL.createObjectURL(new Blob([portableHtml()], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Mind_Harness_独立版.html';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
