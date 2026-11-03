import {
  loadPresentationFile,
  savePresentationFile,
  PresentationWriteConflict,
} from './presentationFileClient';
const snapshot = {
  fields: { title: '已保存' },
  revision: 'revision-1',
  savedAt: '2026-11-02T00:00:00Z',
};
function response(body: unknown, status = 200, type = 'application/json') {
  return new Response(type.includes('json') ? JSON.stringify(body) : String(body), {
    status,
    headers: { 'Content-Type': type },
  });
}
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});
it('reads canonical file content with cache disabled', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response(snapshot));
  expect(await loadPresentationFile()).toEqual({ ...snapshot, writable: true });
  expect(fetch).toHaveBeenCalledWith(
    '/__presentation/content',
    expect.objectContaining({ cache: 'no-store' })
  );
});
it('sends revision and content and waits for the returned saved file', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response(snapshot));
  expect(await savePresentationFile('r0', { title: '新内容' })).toEqual({
    ...snapshot,
    writable: true,
  });
  expect(fetch).toHaveBeenCalledWith(
    '/__presentation/content',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ revision: 'r0', fields: { title: '新内容' } }),
    })
  );
});
it('uses the bundled file read-only on static hosting', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(response('<html/>', 200, 'text/html'))
    .mockResolvedValueOnce(
      response({ format: 'mind-harness-text', version: 1, fields: { title: '静态快照' } })
    );
  expect(await loadPresentationFile()).toMatchObject({
    fields: { title: '静态快照' },
    writable: false,
  });
});
it('does not mask a file read error with an old static snapshot', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ error: '文件损坏' }, 500));
  await expect(loadPresentationFile()).rejects.toThrow('文件损坏');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('returns the conflicting file for recovery', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ current: snapshot }, 409));
  await expect(savePresentationFile('old', {})).rejects.toBeInstanceOf(PresentationWriteConflict);
});
it('never treats an HTML fallback as a successful write', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response('<html/>', 200, 'text/html'));
  await expect(savePresentationFile('r0', {})).rejects.toThrow('保存未成功');
});
it('reports offline without claiming to save locally', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
  await expect(savePresentationFile('r0', {})).rejects.toThrow('无法连接演示保存服务');
});
