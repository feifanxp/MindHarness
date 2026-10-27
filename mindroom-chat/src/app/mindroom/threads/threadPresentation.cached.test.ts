import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { buildThreadRecord } from './threadRecord';
import { resolveCachedOverviewUpdate } from './threadOverviewCacheHydration';

it.each([false, true])(
  'shows the cached thread bundle before replies load (summary: %s)',
  (summary) => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Offline')));
    const userId = '@alice:example.org';
    class OfflineClient extends MatrixClient {
      constructor() {
        super({ baseUrl: 'https://example.org', userId, fetchFn });
        this.clientOpts = { threadSupport: true };
        this.threadSupportPending = new Promise(() => {});
      }
    }
    const mx = new OfflineClient();
    const room = new Room('!room:example.org', mx, userId, { timelineSupport: true });
    mx.store.storeRoom(room);
    const root = new MatrixEvent({
      event_id: '$root',
      room_id: room.roomId,
      sender: userId,
      type: 'm.room.message',
      origin_server_ts: 1000,
      content: { msgtype: 'm.text', body: 'Original question' },
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 24,
            current_user_participated: true,
            latest_event: {
              event_id: '$latest',
              room_id: room.roomId,
              sender: userId,
              origin_server_ts: 2000,
              type: 'm.room.message',
              content: {
                msgtype: summary ? 'm.notice' : 'm.text',
                body: summary ? 'Saved summary' : 'Saved last reply',
                ...(summary ? { 'io.mindroom.thread_summary': true } : {}),
                'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
              },
            },
          },
        },
      },
    });
    room.processThreadRoots([root], true);
    const record = buildThreadRecord({ room, threadRootId: '$root' });
    if (summary) expect(record.presentation.summaryText).toBe('Saved summary');
    else expect(record.presentation.latestReplyPreviewText).toBe('Saved last reply');
    if (!summary) expect(record.presentation.lastSenderId).toBe(userId);
    expect(record.presentation.messageCount).toBe(24);
    expect(room.getThread('$root')?.events).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
    if (summary) {
      const update = resolveCachedOverviewUpdate({
        rootId: '$root',
        room,
        mapper: mx.getEventMapper(),
        cachedPage: {
          hasMoreBefore: false,
          events: [
            {
              event_id: '$cached-reply',
              room_id: room.roomId,
              sender: userId,
              type: 'm.room.message',
              origin_server_ts: 1500,
              content: {
                msgtype: 'm.text',
                body: 'Last message before summary',
                'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
              },
            },
          ],
        },
        currentRecord: record,
        currentRootEvent: root,
        showCompactRoomView: true,
        compactCachedThreadRootBodyMap: new Map(),
        compactThreadRootBodyMap: new Map(),
      });
      expect(update?.nextReplyPreviewText).toBe('Last message before summary');
    }
    const newer = buildThreadRecord({
      room,
      threadRootId: '$root',
      fallbackLatestReplyPreviewText: 'Newer cached reply',
      fallbackLastSenderId: '@bob:example.org',
      summaryInfo: { summaryText: 'Newer cached summary', generatedTs: 3000 },
    });
    expect(newer.presentation.latestReplyPreviewText).toBe('Newer cached reply');
    expect(newer.presentation.lastSenderId).toBe('@bob:example.org');
    expect(newer.presentation.summaryText).toBe('Newer cached summary');
    const liveReply = new MatrixEvent({
      event_id: '$live-reply',
      room_id: room.roomId,
      sender: '@bob:example.org',
      type: 'm.room.message',
      origin_server_ts: 4000,
      content: {
        msgtype: 'm.text',
        body: 'New live reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    const thread = room.getThread('$root')!;
    const olderReply = new MatrixEvent({
      ...liveReply.event,
      event_id: '$older-reply',
      sender: '@older:example.org',
      origin_server_ts: 1500,
      content: { ...liveReply.getContent(), body: 'Older loaded reply' },
    });
    thread.timelineSet.addEventsToTimeline([olderReply], true, false, thread.liveTimeline);
    const partial = buildThreadRecord({ room, threadRootId: '$root' }).presentation;
    expect(partial.latestReplyPreviewText).toBe(
      summary ? 'Older loaded reply' : 'Saved last reply'
    );
    expect(partial.lastSenderId).toBe(summary ? '@older:example.org' : userId);
    if (!summary) {
      const bundled = thread.replyToEvent!;
      const savedBody = bundled.getContent().body;
      bundled.getContent().body = '';
      const readable = buildThreadRecord({ room, threadRootId: '$root' }).presentation;
      expect(readable.latestReplyPreviewText).toBe('Older loaded reply');
      expect(readable.lastSenderId).toBe('@older:example.org');
      bundled.getContent().body = savedBody;
    }
    thread.timelineSet.addLiveEvent(liveReply, { addToState: false });
    expect(
      buildThreadRecord({
        room,
        threadRootId: '$root',
        fallbackLatestReplyPreviewText: 'Newer cached reply',
      }).presentation.latestReplyPreviewText
    ).toBe('New live reply');
  }
);
