import { EventStatus, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import {
  getMindroomThreadSummaryInfo,
  getThreadSummaryEventInfo,
  getLatestThreadSummaryInfoFromEventSources,
} from '../messages/threadSummary';
import {
  getThreadSummaryActionError,
  requestThreadSummary,
  saveThreadSummary,
} from './threadSummaryActions';
import {
  clearThreadSummarySharedState,
  getThreadSummaryStateSnapshot,
  ensureThreadSummaryStateLoaded,
  storeThreadSummaryInState,
} from './threadSummaryState';
import {
  loadCachedThreadSummaries,
  loadLatestCachedThreadEvents,
  saveCachedThreadSummary,
} from './cacheStore';
import { resolveThreadSummaryInfo } from './threadPresentation';

vi.mock('./cacheStore', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  loadLatestCachedThreadEvents: vi.fn().mockResolvedValue({ events: [], hasMoreBefore: false }),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));

const getStoredSummary = () =>
  getThreadSummaryStateSnapshot(
    createSessionId('https://matrix.test', '@me:test'),
    '!room:test'
  ).get('$root');

const setup = () => {
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: '!room:test',
    sender: '@me:test',
    origin_server_ts: 1,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Root' },
  });
  const room = {
    roomId: '!room:test',
    getThread: () => undefined,
    getEventForTxnId: () => undefined,
    findEventById: (id: string) => (id === '$root' ? root : undefined),
    getMember: (id: string) =>
      id === '@mindroom_helper:test' ? { membership: 'join' } : undefined,
    getMyMembership: () => 'join',
    currentState: { maySendEvent: () => true },
  } as unknown as Room;
  const sendMessage = vi.fn().mockResolvedValue({ event_id: '$summary' });
  const mx = {
    sendMessage,
    fetchRoomEvent: vi.fn().mockImplementation(async () => ({ origin_server_ts: Date.now() })),
    getSafeUserId: () => '@me:test',
    getHomeserverUrl: () => 'https://matrix.test',
    makeTxnId: () => 'summary-transaction',
    getEventMapper: () => (event: ConstructorParameters<typeof MatrixEvent>[0]) =>
      new MatrixEvent(event),
    cancelPendingEvent: vi.fn(),
  } as unknown as MatrixClient;
  return { room, mx, sendMessage };
};

describe('thread summary actions', () => {
  beforeEach(() => {
    clearThreadSummarySharedState();
    vi.mocked(loadCachedThreadSummaries).mockResolvedValue(new Map());
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValue({ events: [], hasMoreBefore: false });
    vi.mocked(saveCachedThreadSummary).mockClear();
  });

  it('updates shared overview and banner state only after the server accepts a manual summary', async () => {
    const { room, mx, sendMessage } = setup();
    let accept!: (value: { event_id: string }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    const save = saveThreadSummary(mx, room, '$root', 'New title');
    expect(getStoredSummary()).toBeUndefined();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    accept({ event_id: '$summary' });
    await save;
    expect(getStoredSummary()).toMatchObject({
      summaryText: 'New title',
      isManual: true,
      eventId: '$summary',
    });
  });

  it('keeps the accepted manual title when an automatic notice arrives during send, including reload', async () => {
    const { room, mx, sendMessage } = setup();
    const sessionId = createSessionId('https://matrix.test', '@me:test');
    let accept!: (value: { event_id: string }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    const saving = saveThreadSummary(mx, room, '$root', 'Human title');
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    const content = sendMessage.mock.calls[0][2];
    const generatedTs = getMindroomThreadSummaryInfo(content)!.generatedTs!;
    const automatic = new MatrixEvent({
      event_id: '$auto',
      type: 'm.room.message',
      origin_server_ts: generatedTs + 100,
      content: {
        msgtype: 'm.notice',
        body: 'Automatic title',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Automatic title',
          generated_at: new Date(generatedTs + 100).toISOString(),
          message_count: 10,
        },
      },
    });
    storeThreadSummaryInState(
      sessionId,
      room.roomId,
      '$root',
      getThreadSummaryEventInfo(automatic)
    );
    vi.mocked(mx.fetchRoomEvent).mockResolvedValue({ origin_server_ts: generatedTs + 200 });
    accept({ event_id: '$summary' });
    await saving;
    expect(getStoredSummary()?.summaryText).toBe('Human title');
    const accepted = getStoredSummary()!;
    clearThreadSummarySharedState();
    vi.mocked(loadCachedThreadSummaries).mockResolvedValue(new Map([['$root', accepted]]));
    await ensureThreadSummaryStateLoaded(sessionId, room.roomId);
    expect(
      resolveThreadSummaryInfo({
        preferredSummaryInfo: getStoredSummary(),
        thread: { events: [automatic], timeline: [automatic] },
      })?.summaryText
    ).toBe('Human title');
  });

  it('does not report a failed save if acceptance timestamp lookup fails', async () => {
    const { room, mx, sendMessage } = setup();
    vi.mocked(mx.fetchRoomEvent).mockRejectedValue(new Error('Temporary read failure'));
    await saveThreadSummary(mx, room, '$root', 'Accepted title');
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(getStoredSummary()?.summaryText).toBe('Accepted title');
    const remote = new MatrixEvent({
      event_id: '$summary',
      type: 'm.room.message',
      origin_server_ts: 1200,
      content: sendMessage.mock.calls[0][2],
    });
    storeThreadSummaryInState(
      createSessionId('https://matrix.test', '@me:test'),
      room.roomId,
      '$root',
      getThreadSummaryEventInfo(remote)
    );
    expect(getStoredSummary()).toMatchObject({ summaryText: 'Accepted title', eventTs: 1200 });
  });
  it.each(['cache', 'live', 'cached-events'])(
    'replaces a future-dated %s summary and preserves the edit after cache reload',
    async (source) => {
      const { room, mx, sendMessage } = setup();
      const prior = {
        summaryText: 'Clock-skewed title',
        generatedTs: Date.now() + 86_400_000,
        messageCount: 99,
      };
      if (source === 'cache') {
        vi.mocked(loadCachedThreadSummaries).mockResolvedValue(new Map([['$root', prior]]));
      } else {
        const notice = new MatrixEvent({
          event_id: '$old-summary',
          type: 'm.room.message',
          content: {
            msgtype: 'm.notice',
            body: prior.summaryText,
            'io.mindroom.thread_summary': {
              version: 1,
              summary: prior.summaryText,
              generated_at: new Date(prior.generatedTs).toISOString(),
              message_count: 99,
            },
            'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          },
        });
        if (source === 'cached-events') {
          vi.mocked(loadLatestCachedThreadEvents).mockResolvedValue({
            events: [{ ...notice.event, event_id: '$old-summary', origin_server_ts: 1 }],
            hasMoreBefore: false,
          });
        } else {
          room.getThread = () =>
            ({ events: [notice], timeline: [notice] } as ReturnType<Room['getThread']>);
        }
      }
      await saveThreadSummary(mx, room, '$root', 'Human title wins');
      expect(getStoredSummary()?.summaryText).toBe('Human title wins');
      const written = getMindroomThreadSummaryInfo(sendMessage.mock.calls[0][2]);
      expect(written?.generatedTs).toBeGreaterThan(prior.generatedTs);
      if (source === 'cached-events') {
        const cachedPage = await loadLatestCachedThreadEvents('session', room.roomId, '$root', 32);
        storeThreadSummaryInState(
          createSessionId('https://matrix.test', '@me:test'),
          room.roomId,
          '$root',
          getLatestThreadSummaryInfoFromEventSources(
            cachedPage.events.map((event) => new MatrixEvent(event))
          )
        );
        expect(getStoredSummary()?.summaryText).toBe('Human title wins');
      }
      expect(
        resolveThreadSummaryInfo({
          preferredSummaryInfo: getStoredSummary(),
          thread: room.getThread('$root'),
        })?.summaryText
      ).toBe('Human title wins');
      expect(saveCachedThreadSummary).toHaveBeenLastCalledWith(
        expect.any(String),
        '!room:test',
        '$root',
        expect.objectContaining(written!)
      );
      const persisted = getStoredSummary()!;
      clearThreadSummarySharedState();
      vi.mocked(loadCachedThreadSummaries).mockResolvedValue(new Map([['$root', persisted]]));
      await ensureThreadSummaryStateLoaded(
        createSessionId('https://matrix.test', '@me:test'),
        '!room:test'
      );
      expect(
        resolveThreadSummaryInfo({
          preferredSummaryInfo: getStoredSummary(),
          thread: room.getThread('$root'),
        })?.summaryText
      ).toBe('Human title wins');
    }
  );

  it('still saves when the optional event cache is unavailable', async () => {
    const { room, mx, sendMessage } = setup();
    vi.mocked(loadLatestCachedThreadEvents).mockRejectedValue(new Error('Cache unavailable'));
    await saveThreadSummary(mx, room, '$root', 'Manual title');
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(getStoredSummary()?.summaryText).toBe('Manual title');
  });

  it('replaces an unsupported cached date without overflowing the summary clock', async () => {
    const { room, mx, sendMessage } = setup();
    vi.mocked(loadCachedThreadSummaries).mockResolvedValue(
      new Map([
        [
          '$root',
          {
            summaryText: 'Unsupported date',
            generatedTs: Date.parse('+275760-09-13T00:00:00.000Z'),
            messageCount: 99,
          },
        ],
      ])
    );
    await saveThreadSummary(mx, room, '$root', 'Valid manual title');
    expect(getStoredSummary()?.summaryText).toBe('Valid manual title');
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('rejects the terminal supported date deliberately without sending an unordered replacement', async () => {
    const { room, mx, sendMessage } = setup();
    vi.mocked(loadCachedThreadSummaries).mockResolvedValue(
      new Map([
        [
          '$root',
          {
            summaryText: 'Terminal date',
            generatedTs: Date.parse('9999-12-31T23:59:59.999Z'),
          },
        ],
      ])
    );
    await expect(saveThreadSummary(mx, room, '$root', 'Retain my draft')).rejects.toThrow(
      'The current summary timestamp cannot be advanced.'
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getStoredSummary()?.summaryText).toBe('Terminal date');
  });

  it('removes its failed local echo so a retry does not leave a stale summary or block sends', async () => {
    const { room, mx, sendMessage } = setup();
    const pending = new MatrixEvent({
      event_id: '~local',
      type: 'm.room.message',
      content: { body: 'Failed summary', msgtype: 'm.notice' },
    });
    pending.setStatus(EventStatus.NOT_SENT);
    room.getEventForTxnId = vi.fn().mockReturnValue(pending);
    sendMessage.mockRejectedValue(new Error('Offline'));
    await expect(saveThreadSummary(mx, room, '$root', 'Failed summary')).rejects.toThrow('Offline');
    expect(room.getEventForTxnId).toHaveBeenCalledWith('summary-transaction');
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(pending);
  });
  it('publishes a normalized manual summary through the shared notice format in the selected thread', async () => {
    const { room, mx, sendMessage } = setup();
    await saveThreadSummary(mx, room, '$root', '  Updated\n summary  ');
    const [roomId, threadId, content] = sendMessage.mock.calls[0];
    expect([roomId, threadId]).toEqual(['!room:test', '$root']);
    expect(content).toMatchObject({
      msgtype: 'm.notice',
      body: 'Updated summary',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      'io.mindroom.thread_summary': {
        version: 1,
        summary: 'Updated summary',
        model: 'manual',
        pinned: true,
      },
    });
    expect(getMindroomThreadSummaryInfo(content)?.summaryText).toBe('Updated summary');
    expect(getMindroomThreadSummaryInfo(content)?.generatedTs).toBeGreaterThan(0);
  });

  it.each(['', '  ', 'x'.repeat(301)])(
    'rejects invalid summary text without sending',
    async (text) => {
      const { room, mx, sendMessage } = setup();
      await expect(saveThreadSummary(mx, room, '$root', text)).rejects.toThrow();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['~pending', '$missing'])(
    'does not mutate an unconfirmed or unknown thread: %s',
    async (rootId) => {
      const { room, mx, sendMessage } = setup();
      await expect(saveThreadSummary(mx, room, rootId, 'Summary')).rejects.toThrow();
      await expect(
        requestThreadSummary(mx, room, rootId, '@mindroom_helper:test')
      ).rejects.toThrow();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['~pending', '$missing'])(
    'reports unavailable roots to both menu and actions: %s',
    (threadId) => {
      const { room, mx } = setup();
      expect(getThreadSummaryActionError(mx, room, threadId)).toBe(
        'A confirmed thread is required.'
      );
    }
  );

  it.each(['leave', 'no-permission'])(
    'keeps menu eligibility and mutation enforcement aligned: %s',
    async (restriction) => {
      const { room, mx, sendMessage } = setup();
      if (restriction === 'leave') room.getMyMembership = () => 'leave';
      else room.currentState.maySendEvent = () => false;
      expect(getThreadSummaryActionError(mx, room, '$root')).toBe(
        'You cannot send messages in this room.'
      );
      await expect(saveThreadSummary(mx, room, '$root', 'Summary')).rejects.toThrow(
        'You cannot send messages in this room.'
      );
      await expect(
        requestThreadSummary(mx, room, '$root', '@mindroom_helper:test')
      ).rejects.toThrow('You cannot send messages in this room.');
      expect(sendMessage).not.toHaveBeenCalled();
    }
  );

  it('requests regeneration from exactly the selected agent inside the selected thread', async () => {
    const { room, mx, sendMessage } = setup();
    await requestThreadSummary(mx, room, '$root', '@mindroom_helper:test');
    expect(sendMessage).toHaveBeenCalledWith(
      '!room:test',
      '$root',
      expect.objectContaining({
        msgtype: 'm.text',
        'm.mentions': { user_ids: ['@mindroom_helper:test'] },
        'm.relates_to': expect.objectContaining({ rel_type: 'm.thread', event_id: '$root' }),
      }),
      'summary-transaction'
    );
    expect(sendMessage.mock.calls[0][2].body).toContain('set_thread_summary');
    expect(sendMessage.mock.calls[0][2].body).toContain('pin=true');
  });

  it('rejects an agent that is no longer joined', async () => {
    const { room, mx, sendMessage } = setup();
    await expect(
      requestThreadSummary(mx, room, '$root', '@mindroom_absent:test')
    ).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('propagates send failure so the editor can retain the draft', async () => {
    const { room, mx, sendMessage } = setup();
    sendMessage.mockRejectedValue(new Error('Offline'));
    await expect(saveThreadSummary(mx, room, '$root', 'Keep this draft')).rejects.toThrow(
      'Offline'
    );
    expect(getStoredSummary()).toBeUndefined();
  });
});
