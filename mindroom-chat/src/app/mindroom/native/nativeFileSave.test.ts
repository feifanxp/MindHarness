// @vitest-environment jsdom

import { Capacitor, registerPlugin } from '@capacitor/core';
import FileSaver from 'file-saver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFile } from './nativeFileSave';

const nativePlugin = vi.hoisted(() => ({
  beginSave: vi.fn(),
  appendSave: vi.fn(),
  presentSave: vi.fn(),
  abortSave: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => nativePlugin),
}));

vi.mock('file-saver', () => ({
  default: {
    saveAs: vi.fn(),
  },
}));

describe('saveFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    nativePlugin.beginSave.mockResolvedValue({ id: 'save-1' });
    nativePlugin.appendSave.mockResolvedValue(undefined);
    nativePlugin.presentSave.mockResolvedValue({ saved: true });
    nativePlugin.abortSave.mockResolvedValue(undefined);
  });

  it('keeps FileSaver behavior outside native iOS', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    await expect(saveFile(blob, 'hello.txt')).resolves.toBe(true);

    expect(FileSaver.saveAs).toHaveBeenCalledWith(blob, 'hello.txt');
    expect(registerPlugin).not.toHaveBeenCalled();
  });

  it('opens the native iOS save prompt with the file bytes and name', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    await expect(saveFile(new Blob(['hello']), 'agent-output.txt')).resolves.toBe(true);

    expect(registerPlugin).toHaveBeenCalledWith('MindRoomFileSave');
    expect(nativePlugin.beginSave).toHaveBeenCalledWith({
      fileName: 'agent-output.txt',
      pageId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(nativePlugin.appendSave).toHaveBeenCalledWith({
      id: 'save-1',
      data: 'aGVsbG8=',
    });
    expect(nativePlugin.presentSave).toHaveBeenCalledWith({ id: 'save-1' });
    expect(FileSaver.saveAs).not.toHaveBeenCalled();
  });

  it('uses one owner id per page so native code can replace sessions abandoned by a reload', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    await saveFile(new Blob(['first']), 'first.txt');
    await saveFile(new Blob(['second']), 'second.txt');

    const firstPageId = nativePlugin.beginSave.mock.calls[0][0].pageId;
    const secondPageId = nativePlugin.beginSave.mock.calls[1][0].pageId;
    expect(firstPageId).toMatch(/^[0-9a-f]{32}$/);
    expect(secondPageId).toBe(firstPageId);

    vi.resetModules();
    const { saveFile: saveFileAfterReload } = await import('./nativeFileSave');
    await saveFileAfterReload(new Blob(['third']), 'third.txt');

    expect(nativePlugin.beginSave.mock.calls[2][0].pageId).not.toBe(firstPageId);
  });

  it('reports cancellation without treating it as a failed download', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.presentSave.mockResolvedValue({ saved: false });

    await expect(saveFile(new Blob(['hello']), 'agent-output.txt')).resolves.toBe(false);
  });

  it('loads an object URL before handing it to the native picker', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    const pdfBlob = new Blob(['pdf']);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: async () => pdfBlob,
      ok: true,
    } as Response);

    await expect(saveFile('blob:attachment', 'attachment.pdf')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('blob:attachment');
    expect(nativePlugin.appendSave).toHaveBeenCalledWith({
      id: 'save-1',
      data: 'cGRm',
    });
  });

  it('uploads large attachments to the native plugin in bounded ordered chunks', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    const bytes = new Uint8Array(256 * 1024 + 17);
    bytes.forEach((_, index) => {
      bytes[index] = index % 251;
    });

    await expect(saveFile(new Blob([bytes]), 'large.bin')).resolves.toBe(true);

    expect(nativePlugin.appendSave).toHaveBeenCalledTimes(2);
    const chunks = nativePlugin.appendSave.mock.calls.map(([options]) =>
      Uint8Array.from(atob(options.data), (character) => character.charCodeAt(0))
    );
    expect(chunks[0]).toHaveLength(256 * 1024);
    expect(chunks[1]).toHaveLength(17);
    const uploadedBytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let uploadOffset = 0;
    chunks.forEach((chunk) => {
      uploadedBytes.set(chunk, uploadOffset);
      uploadOffset += chunk.length;
    });
    expect(uploadedBytes).toEqual(bytes);
    expect(nativePlugin.beginSave.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlugin.appendSave.mock.invocationCallOrder[0]
    );
    expect(nativePlugin.appendSave.mock.invocationCallOrder[1]).toBeLessThan(
      nativePlugin.presentSave.mock.invocationCallOrder[0]
    );
  });

  it('aborts the native session when a chunk cannot be appended', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativePlugin.appendSave.mockRejectedValue(new Error('disk full'));

    await expect(saveFile(new Blob(['hello']), 'agent-output.txt')).rejects.toThrow('disk full');

    expect(nativePlugin.abortSave).toHaveBeenCalledWith({ id: 'save-1' });
    expect(nativePlugin.presentSave).not.toHaveBeenCalled();
  });
});
