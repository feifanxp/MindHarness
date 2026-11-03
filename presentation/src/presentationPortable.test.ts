import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PresentationEditor, PresentationEditButton } from './PresentationEditor';
import {
  isPortablePresentation,
  encodePortableContent,
  readPortablePresentation,
  writePortablePresentation,
  portableHtml,
  PORTABLE_CONTENT_ID,
} from './presentationPortable';
import { loadPresentationFile, savePresentationFile } from './presentationFileClient';
import { decodePresentationDraft } from './presentationDraft';

function mountContent(fields: Record<string, string> = {}) {
  const root = document.createElement('div');
  root.id = 'root';
  root.textContent = '运行中的临时界面';
  document.body.append(root);
  const data = document.createElement('script');
  data.id = PORTABLE_CONTENT_ID;
  data.type = 'application/json';
  data.dataset.revision = '0';
  data.textContent = encodePortableContent(fields, null);
  document.body.append(data);
  const runtime = document.createElement('script');
  runtime.id = 'mind-harness-runtime';
  runtime.textContent = '/* self-contained runtime */';
  document.body.append(runtime);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.getElementById('root')?.remove();
  document.getElementById(PORTABLE_CONTENT_ID)?.remove();
  document.getElementById('mind-harness-runtime')?.remove();
});
it('leaves the normal server client unchanged when no portable data is present', () => {
  expect(isPortablePresentation()).toBe(false);
  expect(readPortablePresentation()).toBeNull();
});
it('reads embedded fields and saves without making a network request', async () => {
  mountContent({ title: '文件里的标题' });
  const loaded = await loadPresentationFile();
  expect(loaded.fields.title).toBe('文件里的标题');
  const saved = await savePresentationFile(loaded.revision, { title: '修改后\n第二行' });
  expect(saved.revision).not.toBe(loaded.revision);
  expect((await loadPresentationFile()).fields.title).toBe('修改后\n第二行');
  expect(fetch).not.toHaveBeenCalled();
});
it('exports a complete HTML with the current edits and no mounted React interface', () => {
  mountContent();
  const initial = readPortablePresentation()!;
  const fields = { title: '已修改的标题', notes: '独立讲稿\n过渡' };
  writePortablePresentation(initial.revision, fields);
  const html = portableHtml();
  const copy = new DOMParser().parseFromString(html, 'text/html');
  expect(html.startsWith('<!doctype html>\n')).toBe(true);
  expect(copy.querySelector('#root')?.childNodes).toHaveLength(0);
  expect(copy.querySelector('#mind-harness-runtime')).not.toBeNull();
  expect(
    decodePresentationDraft(copy.querySelector('#' + PORTABLE_CONTENT_ID)!.textContent!)
  ).toEqual(fields);
});
it('round-trips closing script tags as plain text rather than executable markup', () => {
  const fields = { title: '</script><script>alert(1)</script>', notes: '<>&\u2028\u2029' };
  const encoded = encodePortableContent(fields, null);
  expect(encoded).not.toContain('</script>');
  expect(decodePresentationDraft(encoded)).toEqual(fields);
  mountContent(fields);
  const copy = new DOMParser().parseFromString(portableHtml(), 'text/html');
  expect(copy.querySelectorAll('script')).toHaveLength(2);
  expect(
    decodePresentationDraft(copy.querySelector('#' + PORTABLE_CONTENT_ID)!.textContent!)
  ).toEqual(fields);
});
it('rejects stale revisions and preserves the current embedded content', () => {
  mountContent();
  const initial = readPortablePresentation()!;
  writePortablePresentation(initial.revision, { title: '最新' });
  expect(() => writePortablePresentation(initial.revision, { title: '过期' })).toThrow();
  expect(readPortablePresentation()?.fields.title).toBe('最新');
});

it('enables standalone editing and HTML export without relying on network or browser storage', async () => {
  mountContent();
  const storageRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('file storage unavailable');
  });
  render(createElement(PresentationEditor, { children: createElement(PresentationEditButton) }));
  await waitFor(() => expect(screen.getByRole('button', { name: '编辑内容' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
  expect(screen.getByRole('button', { name: '保存新版 HTML' })).toBeEnabled();
  expect(screen.getByRole('link', { name: '独立讲稿' })).toHaveAttribute('href', '#speaker-notes');
  expect(storageRead).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
