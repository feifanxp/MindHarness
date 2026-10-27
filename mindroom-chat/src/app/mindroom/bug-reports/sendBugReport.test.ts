import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/matrix')>()),
  encryptFile: vi.fn(async (file: File) => ({
    encInfo: { key: { k: 'secret' }, iv: 'iv', hashes: { sha256: 'h' }, v: 'v2' },
    file,
    originalFile: file,
  })),
}));

import type { BugReport } from './bugReportPayload';
import { buildBugReportSummary, sendBugReport } from './sendBugReport';

const report = {
  type: 'io.mindroom.bug_report',
  version: 1,
  reportedAt: '2026-10-03T12:00:00.000Z',
  reporter: { userId: '@alice:example.com', deviceId: 'D', homeserver: 'https://hs' },
  target: {
    roomId: '!r:example.com',
    roomName: 'Lobby',
    threadId: '$root',
    eventId: '$reply',
    permalink: 'https://chat.example/#/!r:example.com/$reply',
  },
  events: [],
  client: { build: 'abc123', platform: 'ios' },
  diagnostics: {},
} as unknown as BugReport;

const client = () => {
  const calls: string[] = [];
  return {
    calls,
    getUser: () => ({ displayName: 'Alice' }),
    sendMessage: vi.fn(async (_roomId: string, threadIdOrContent: unknown) => {
      const isRoot = !!threadIdOrContent && typeof threadIdOrContent === 'object';
      calls.push(isRoot ? 'send summary' : 'send file');
      return isRoot ? { event_id: '$summary' } : { event_id: '$file' };
    }),
    uploadContent: vi.fn(async (_file: File): Promise<{ content_uri?: string }> => {
      calls.push('upload');
      return { content_uri: 'mxc://example.com/abc' };
    }),
  };
};

const plainRoom = { roomId: '!reports:example.com', hasEncryptionStateEvent: () => false };

describe('buildBugReportSummary', () => {
  it('lists who, where, and which client, with permalinks', () => {
    const summary = buildBugReportSummary(report, 'Alice');
    expect(summary).toContain('Bug report from Alice (@alice:example.com)');
    expect(summary).toContain('Message: https://chat.example/#/!r:example.com/$reply');
    expect(summary).toContain('Thread: ');
    expect(summary).toContain('Room: Lobby');
    expect(summary).toContain('Client: MindRoom Chat abc123 (ios)');
  });
});

describe('sendBugReport', () => {
  it('posts the summary root and the JSON file as a reply in its thread', async () => {
    const mx = client();
    const result = await sendBugReport(mx as never, plainRoom as never, report);
    expect(result).toEqual({ roomId: '!reports:example.com', threadRootId: '$summary' });

    const [summaryRoomId, summaryContent] = mx.sendMessage.mock.calls[0];
    expect(summaryRoomId).toBe('!reports:example.com');
    expect(summaryContent).toMatchObject({
      msgtype: 'm.text',
      'io.mindroom.bug_report': {
        version: 1,
        room_id: '!r:example.com',
        thread_id: '$root',
        event_id: '$reply',
      },
    });

    const [fileRoomId, fileThreadId, fileContent] = mx.sendMessage.mock.calls[1];
    expect(fileRoomId).toBe('!reports:example.com');
    expect(fileThreadId).toBe('$summary');
    expect(fileContent).toMatchObject({
      msgtype: 'm.file',
      body: 'mindroom-bug-report-2026-10-03T12-00-00-000Z.json',
      url: 'mxc://example.com/abc',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$summary' },
    });
  });

  it('encrypts the file when the report room is encrypted', async () => {
    const mx = client();
    const reportRoom = { roomId: '!reports:example.com', hasEncryptionStateEvent: () => true };
    await sendBugReport(mx as never, reportRoom as never, report);
    const fileContent = mx.sendMessage.mock.calls[1][2] as Record<string, unknown>;
    expect(fileContent.url).toBeUndefined();
    expect(fileContent.file).toMatchObject({ url: 'mxc://example.com/abc', iv: 'iv' });
  });

  it('uploads compact JSON before posting the summary root', async () => {
    const mx = client();
    await sendBugReport(mx as never, plainRoom as never, report);
    expect(mx.calls).toEqual(['upload', 'send summary', 'send file']);
    const uploaded = mx.uploadContent.mock.calls[0][0];
    expect(await uploaded.text()).toBe(JSON.stringify(report));
  });

  it('leaves nothing in the report room when the upload fails', async () => {
    const mx = client();
    mx.uploadContent.mockRejectedValueOnce(new Error('M_TOO_LARGE'));
    await expect(sendBugReport(mx as never, plainRoom as never, report)).rejects.toThrow(
      'M_TOO_LARGE'
    );
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });

  it('fails without sending anything when the upload returns no content URI', async () => {
    const mx = client();
    mx.uploadContent.mockResolvedValueOnce({});
    await expect(sendBugReport(mx as never, plainRoom as never, report)).rejects.toThrow();
    expect(mx.sendMessage).not.toHaveBeenCalled();
  });
});
