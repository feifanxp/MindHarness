import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditableText, PresentationEditor, PresentationEditButton } from './PresentationEditor';
import {
  decodePresentationDraft,
  encodePresentationDraft,
  PRESENTATION_DRAFT_KEY,
} from './presentationDraft';
import {
  loadPresentationFile,
  savePresentationFile,
  PresentationWriteConflict,
  type PresentationFile,
} from './presentationFileClient';

vi.mock('./presentationFileClient', async importOriginal => ({
  ...(await importOriginal<typeof import('./presentationFileClient')>()),
  loadPresentationFile: vi.fn(),
  savePresentationFile: vi.fn(),
}));
let server: PresentationFile;
let revision = 0;
function copy() {
  return { ...server, fields: { ...server.fields } };
}
function Example() {
  return (
    <PresentationEditor>
      <PresentationEditButton />
      <h1>
        <EditableText id="slide.example.title" text="原始标题" label="标题" />
      </h1>
    </PresentationEditor>
  );
}
async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: '编辑内容' })).toBeEnabled());
}
async function openEditor() {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '编辑内容' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑：标题' }));
}
function submit(text: string) {
  fireEvent.change(screen.getByLabelText('文字内容'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '应用修改' }));
}
async function saved() {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    },
  });
});
afterAll(() => {
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  localStorage.clear();
  revision = 0;
  server = { fields: {}, revision: 'r0', savedAt: null, writable: true };
  vi.mocked(loadPresentationFile).mockImplementation(async () => copy());
  vi.mocked(savePresentationFile).mockImplementation(async (expected, fields) => {
    if (expected !== server.revision) throw new PresentationWriteConflict(copy());
    server = {
      fields: { ...fields },
      revision: 'r' + ++revision,
      savedAt: '2026-11-02T08:00:00Z',
      writable: true,
    };
    return copy();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('file-backed presentation editor', () => {
  it('loads saved content on a device with no browser data', async () => {
    server.fields = { 'slide.example.title': '另一个设备保存的标题' };
    render(<Example />);
    await ready();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('另一个设备保存的标题');
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBeNull();
  });
  it('writes multiline content to the service and reads it after remount without localStorage', async () => {
    const first = render(<Example />);
    await openEditor();
    const text = '新标题\n<img src=x onerror=alert(1)>';
    submit(text);
    await saved();
    expect(server.fields['slide.example.title']).toBe(text);
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBeNull();
    first.unmount();
    render(<Example />);
    await ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(text);
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('does not report a save or close the editor before server acknowledgement', async () => {
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    vi.mocked(savePresentationFile).mockImplementationOnce(async (_revision, fields) => {
      await barrier;
      server = { ...server, fields, revision: 'r1' };
      return copy();
    });
    render(<Example />);
    await openEditor();
    submit('等待确认');
    await waitFor(() => expect(screen.getByRole('button', { name: '正在写入…' })).toBeDisabled());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('原始标题');
    release();
    await saved();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('等待确认');
  });
  it('retains the editing text and old file on a failed save', async () => {
    vi.mocked(savePresentationFile).mockRejectedValueOnce(new Error('写入文件失败'));
    render(<Example />);
    await openEditor();
    submit('尚未写入');
    await waitFor(() => expect(screen.getAllByText('写入文件失败').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('文字内容')).toHaveValue('尚未写入');
    expect(server.fields).toEqual({});
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBeNull();
  });
  it('cancels without writing', async () => {
    render(<Example />);
    await openEditor();
    fireEvent.change(screen.getByLabelText('文字内容'), { target: { value: '不要保存' } });
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    expect(savePresentationFile).not.toHaveBeenCalled();
  });
  it('preserves other fields when saving or restoring this field', async () => {
    render(<Example />);
    await openEditor();
    server = { ...server, fields: { other: '其他设备新保存' }, revision: 'r-external' };
    submit('');
    await saved();
    expect(server.fields).toEqual({ other: '其他设备新保存', 'slide.example.title': '' });
    fireEvent.click(screen.getByRole('button', { name: '编辑：标题' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复这段原文' }));
    await saved();
    expect(server.fields).toEqual({ other: '其他设备新保存' });
  });
  it('does not overwrite a field another device changed while editing', async () => {
    render(<Example />);
    await openEditor();
    server = { ...server, fields: { 'slide.example.title': '他处更新' }, revision: 'r-new' };
    submit('旧窗口修改');
    await waitFor(() =>
      expect(screen.getAllByText(/这段文字已被其他设备修改/).length).toBeGreaterThan(0)
    );
    expect(server.fields['slide.example.title']).toBe('他处更新');
    expect(screen.getByLabelText('文字内容')).toHaveValue('旧窗口修改');
  });
  it('handles a conflict between reading and writing without losing the pending text', async () => {
    vi.mocked(savePresentationFile).mockImplementationOnce(async () => {
      server = { ...server, fields: { other: '同时写入' }, revision: 'r-conflict' };
      throw new PresentationWriteConflict(copy());
    });
    render(<Example />);
    await openEditor();
    submit('保留输入');
    await waitFor(() =>
      expect(screen.getAllByText(/其他设备已更新文件/).length).toBeGreaterThan(0)
    );
    expect(screen.getByLabelText('文字内容')).toHaveValue('保留输入');
    expect(server.fields).toEqual({ other: '同时写入' });
  });
  it('undoes writes in the file, including consecutive undo operations', async () => {
    render(<Example />);
    await openEditor();
    submit('第一次');
    await saved();
    fireEvent.click(screen.getByRole('button', { name: '编辑：标题' }));
    submit('第二次');
    await saved();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(server.fields['slide.example.title']).toBe('第一次'));
    await waitFor(() => expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(server.fields).toEqual({}));
  });
  it('refreshes content when returning to the page', async () => {
    render(<Example />);
    await ready();
    server = { ...server, fields: { 'slide.example.title': '新版本' }, revision: 'r-refresh' };
    fireEvent.focus(window);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('新版本')
    );
  });
  it('migrates unreleased browser-only edits once and only removes them after a successful write', async () => {
    localStorage.setItem(
      PRESENTATION_DRAFT_KEY,
      encodePresentationDraft({ 'slide.example.title': '本机旧稿' })
    );
    render(<Example />);
    await ready();
    expect(server.fields['slide.example.title']).toBe('本机旧稿');
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBeNull();
  });
  it('keeps local data if migration fails', async () => {
    const legacy = encodePresentationDraft({ 'slide.example.title': '不能丢的旧稿' });
    localStorage.setItem(PRESENTATION_DRAFT_KEY, legacy);
    vi.mocked(savePresentationFile).mockRejectedValueOnce(new Error('服务离线'));
    render(<Example />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('服务离线'));
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBe(legacy);
    expect(server.fields).toEqual({});
  });
  it('does not silently replace an existing file with an older browser draft', async () => {
    const legacy = encodePresentationDraft({ 'slide.example.title': '旧版本' });
    localStorage.setItem(PRESENTATION_DRAFT_KEY, legacy);
    server = {
      ...server,
      fields: { 'slide.example.title': '文件新版本' },
      savedAt: '2026-11-02T08:00:00Z',
    };
    render(<Example />);
    await ready();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('文件新版本');
    expect(screen.getByRole('button', { name: '迁移本机修改' })).toBeEnabled();
    expect(savePresentationFile).not.toHaveBeenCalled();
    expect(localStorage.getItem(PRESENTATION_DRAFT_KEY)).toBe(legacy);
  });
  it('shows static deployed content but disables unavailable saving', async () => {
    server = { ...server, fields: { 'slide.example.title': '静态文件内容' }, writable: false };
    render(<Example />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('静态文件内容')
    );
    expect(screen.getByRole('button', { name: '编辑内容' })).toBeDisabled();
  });
});

describe('presentation backup format', () => {
  it('round-trips multiline and empty text', () => {
    const fields = { title: '', notes: '一行\n第二行' };
    expect(decodePresentationDraft(encodePresentationDraft(fields))).toEqual(fields);
  });
  it.each([
    'null',
    '[]',
    '{}',
    '{"format":"mind-harness-text","version":1,"fields":{"title":123}}',
  ])('rejects invalid backup %s', text => {
    expect(() => decodePresentationDraft(text)).toThrow();
  });
});
