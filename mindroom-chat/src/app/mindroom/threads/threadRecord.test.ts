import { readFileSync } from 'node:fs';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildThreadRecord, buildThreadRecordMap } from './threadRecord';
import * as threadUtils from './threadUtils';

afterEach(() => vi.restoreAllMocks());

const makeEvent = ({
  eventId,
  threadRootId,
  sender = '@sender:server',
  body,
  ts = 1000,
}: {
  eventId: string;
  threadRootId?: string;
  sender?: string;
  body?: string;
  ts?: number;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    threadRootId,
    getSender: () => sender,
    getContent: () => (body ? { body, msgtype: 'm.text' } : {}),
    getType: () => 'm.room.message',
    getRelation: () => (threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!threadRootId && relType === 'm.thread',
    getTs: () => ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const makeRoom = ({
  rootEvent,
  thread,
}: {
  rootEvent?: MatrixEvent;
  thread?: ReturnType<Room['getThread']>;
} = {}): Room =>
  ({
    roomId: '!room:server',
    getThread: vi.fn(() => thread),
    findEventById: vi.fn(() => rootEvent),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    })),
    getMember: vi.fn(() => undefined),
  } as unknown as Room);

describe('buildThreadRecord', () => {
  it('shares one visible-reply snapshot within a build and refreshes it after redaction', () => {
    const root = makeEvent({ eventId: '$root', sender: '@me:server', body: 'Root' });
    const reply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      body: 'Reply',
      ts: 2000,
    });
    const events = [root, reply];
    const room = makeRoom({
      rootEvent: root,
      thread: {
        rootEvent: root,
        events,
        timeline: events,
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => events,
            getNeighbouringTimeline: () => undefined,
          }),
          relations: { getChildEventsForEvent: () => undefined },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });
    const visibleReplies = vi.spyOn(threadUtils, 'getPreferredVisibleThreadReplyEvents');
    const build = () =>
      buildThreadRecord({
        room,
        threadRootId: '$root',
        currentUserId: '@me:server',
      });
    expect(build()).toMatchObject({
      presentation: { messageCount: 1, latestReplyPreviewText: 'Reply' },
      status: { isUnread: true, hasPendingSend: false, hasFailedSend: false },
    });
    expect(visibleReplies).toHaveBeenCalledTimes(1);

    vi.spyOn(reply, 'isRedacted').mockReturnValue(true);
    expect(build()).toMatchObject({
      presentation: { messageCount: 0, participantIds: ['@me:server'] },
      status: { isUnread: false, hasPendingSend: false, hasFailedSend: false },
    });
    expect(visibleReplies).toHaveBeenCalledTimes(2);
  });

  const makeRootWithServerCount = (count: number): MatrixEvent =>
    ({
      ...makeEvent({ eventId: '$root', body: 'Root' }),
      getUnsigned: () => ({ 'm.relations': { 'm.thread': { count } } }),
    } as unknown as MatrixEvent);

  const makeSdkThread = (rootEvent: MatrixEvent, events: MatrixEvent[], length: number) =>
    ({
      id: '$root',
      rootEvent,
      events,
      timeline: events,
      length,
      initialEventsFetched: true,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({
          getEvents: () => events,
          getNeighbouringTimeline: () => undefined,
        }),
        relations: { getChildEventsForEvent: () => undefined },
      }),
    } as unknown as ReturnType<Room['getThread']>);

  const makeReplies = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      makeEvent({
        eventId: `$reply-${index}`,
        threadRootId: '$root',
        body: `Reply ${index}`,
        ts: 2000 + index,
      })
    );

  it("shows a partly loaded thread's total count on the card and the badge", () => {
    const rootEvent = makeRootWithServerCount(24);
    const room = makeRoom({
      rootEvent,
      thread: makeSdkThread(rootEvent, makeReplies(13), 24),
    });

    const record = buildThreadRecord({ room, threadRootId: '$root', fallbackMessageCount: 13 });

    expect(record.presentation.messageCount).toBe(24);
    expect(record.status.replyCount).toBe(24);
  });

  it("does not let a cached count hide the root's server count before the SDK has the thread", () => {
    const rootEvent = makeRootWithServerCount(24);
    const room = makeRoom({ rootEvent });

    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      threadRootEvent: rootEvent,
      fallbackMessageCount: 13,
    });

    expect(record.presentation.messageCount).toBe(24);
    expect(record.status.replyCount).toBe(24);
  });

  it('gives the badge the same count as the card when only fallback counts are known', () => {
    const rootEvent = makeEvent({ eventId: '$root', body: 'Root' });
    const room = makeRoom({ rootEvent });

    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      threadRootEvent: rootEvent,
      fallbackReplyCount: 1,
      fallbackMessageCount: 13,
    });

    expect(record.presentation.messageCount).toBe(13);
    expect(record.status.replyCount).toBe(13);
  });

  it('counts a fully loaded thread exactly on the card and the badge after a redaction', () => {
    // The SDK drops a redacted reply from the thread and its count; the root's bundle and the cache still count it.
    const rootEvent = makeRootWithServerCount(2);
    const room = makeRoom({
      rootEvent,
      thread: makeSdkThread(rootEvent, [rootEvent, ...makeReplies(1)], 1),
    });

    const record = buildThreadRecord({ room, threadRootId: '$root', fallbackMessageCount: 2 });

    expect(record.presentation.messageCount).toBe(1);
    expect(record.status.replyCount).toBe(1);
  });

  it('does not depend on legacy overview metadata compatibility inputs', () => {
    const source = readFileSync(new URL('./threadRecord.ts', import.meta.url), 'utf8');
    const legacyTypeName = ['Thread', 'Overview', 'Metadata'].join('');
    const legacyMapName = ['metadata', 'Map'].join('');
    const legacyOptionName = ['metadata', '?:'].join('');

    expect(source).not.toContain(legacyTypeName);
    expect(source).not.toContain(legacyMapName);
    expect(source).not.toContain(legacyOptionName);
  });

  it('merges canonical presentation and status data before surfaces render it', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const firstReply = makeEvent({
      eventId: '$reply-a',
      threadRootId: '$root',
      sender: '@agent-a:server',
      body: 'First reply',
      ts: 2000,
    });
    const latestReply = makeEvent({
      eventId: '$reply-b',
      threadRootId: '$root',
      sender: '@agent-b:server',
      body: 'Latest reply',
      ts: 3000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [firstReply, latestReply],
        timeline: [firstReply, latestReply],
        length: 99,
        lastReply: () => latestReply,
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, firstReply, latestReply],
            getNeighbouringTimeline: () => undefined,
          }),
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });

    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 8,
        generatedTs: 2000,
      },
      rootPreviewText: 'Cached root preview',
      fallbackLatestReplyPreviewText: 'stale cached reply',
      fallbackMessageCount: 4,
      scheduledStatus: {
        scheduledTaskCount: 1,
        cronDescription: 'At 09:00',
      },
      currentUserId: '@me:server',
      threadResolution: {
        isResolved: true,
        tags: {
          resolved: {
            set_by: '  @resolver:server  ',
            set_at: '2026-08-27T12:00:00.000Z',
          },
          followup: {
            set_by: '@triage:server',
            set_at: '2026-08-27T11:00:00.000Z',
          },
        },
      },
      fallbackParticipantIds: ['@fallback:server'],
      absoluteIndex: 11,
    });

    expect(record).toMatchObject({
      roomId: '!room:server',
      threadRootId: '$root',
      rootEventId: '$root',
      absoluteIndex: 11,
      presentation: {
        summaryText: 'Live AI summary',
        rootPreviewText: 'Cached root preview',
        latestReplyPreviewText: 'Latest reply',
        lastSenderId: '@agent-b:server',
        messageCount: 99,
        participantIds: ['@agent-b:server', '@agent-a:server', '@me:server'],
      },
      status: {
        isResolved: true,
        resolvedByUserId: '@resolver:server',
        isUnread: true,
        scheduledTaskCount: 1,
        cronDescription: 'At 09:00',
        tags: ['followup'],
      },
      cache: {
        eventCount: 2,
        oldestTs: 2000,
        newestTs: 3000,
        relationSnapshotComplete: false,
        tailLoaded: false,
        expectedReplyCount: 99,
      },
    });
  });

  it('uses the thread-scoped receipt to clear unread status when the room read marker is older', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const latestReply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Reply body',
      ts: 3000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [latestReply],
        timeline: [latestReply],
        length: 1,
        lastReply: () => latestReply,
        getEventReadUpTo: vi.fn(() => latestReply.getId()),
        getLastUnthreadedReceiptFor: vi.fn(() => undefined),
        getReadReceiptForUserId: vi.fn(() => null),
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, latestReply],
            getNeighbouringTimeline: () => undefined,
          }),
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });

    const record = buildThreadRecord({
      room,
      threadRootId: '$root',
      threadRootEvent: rootEvent,
      currentUserId: '@me:server',
    });

    expect(record.status.isUnread).toBe(false);
  });

  it('builds a per-room record map from direct source maps', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Reply body',
      ts: 2000,
    });
    const room = makeRoom({
      rootEvent,
      thread: {
        id: '$root',
        rootEvent,
        events: [reply],
        timeline: [reply],
        length: 1,
        lastReply: () => reply,
        getUnfilteredTimelineSet: () => ({
          getLiveTimeline: () => ({
            getEvents: () => [rootEvent, reply],
            getNeighbouringTimeline: () => undefined,
          }),
          relations: {
            getChildEventsForEvent: () => undefined,
          },
        }),
      } as unknown as ReturnType<Room['getThread']>,
    });

    const records = buildThreadRecordMap({
      room,
      threadRootIds: ['$root'],
      summaryMap: new Map([
        [
          '$root',
          {
            summaryText: 'Cached summary',
            messageCount: 2,
            generatedTs: 2000,
          },
        ],
      ]),
      fallbackReplyCountMap: new Map([['$root', 1]]),
      rootPreviewTextMap: new Map([['$root', 'Cached root']]),
      fallbackMessageCountMap: new Map([['$root', 1]]),
      fallbackParticipantMap: new Map([['$root', ['@fallback:server']]]),
      threadResolutionMap: new Map([
        [
          '$root',
          {
            isResolved: true,
            tags: {
              resolved: {},
              canonical: {},
            },
          },
        ],
      ]),
      absoluteIndexMap: new Map([['$root', 42]]),
    });

    expect(records.get('$root')).toMatchObject({
      threadRootId: '$root',
      absoluteIndex: 42,
      presentation: {
        summaryText: 'Cached summary',
        latestReplyPreviewText: 'Reply body',
        replyParticipantIds: ['@agent:server'],
      },
      status: {
        replyCount: 1,
        isResolved: true,
        tags: ['canonical'],
      },
      cache: {
        eventCount: 1,
        oldestTs: 2000,
        newestTs: 2000,
        relationSnapshotComplete: false,
        tailLoaded: false,
        expectedReplyCount: 1,
      },
    });
  });

  it('builds a per-room record map directly from overview fallback maps', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const room = makeRoom({ rootEvent });

    const records = buildThreadRecordMap({
      room,
      threadRootIds: ['$root'],
      threadRootEventMap: new Map([['$root', rootEvent]]),
      rootPreviewTextMap: new Map([['$root', 'Cached root preview']]),
      fallbackLatestReplyPreviewMap: new Map([['$root', 'Cached latest reply']]),
      fallbackLastSenderIdMap: new Map([['$root', '@cached:server']]),
      fallbackMessageCountMap: new Map([['$root', 3]]),
      fallbackLastActivityTsMap: new Map([['$root', 9000]]),
      cacheCoverageMap: new Map([
        [
          '$root',
          {
            eventCount: 3,
            oldestTs: 1000,
            newestTs: 9000,
            backwardToken: null,
            relationSnapshotComplete: true,
            tailLoaded: true,
            expectedReplyCount: 3,
          },
        ],
      ]),
      threadResolutionMap: new Map([
        [
          '$root',
          {
            isResolved: true,
            tags: {
              resolved: {},
              direct: {},
            },
          },
        ],
      ]),
      scheduledStatusMap: new Map([['$root', { scheduledTaskCount: 2 }]]),
      absoluteIndexMap: new Map([['$root', 5]]),
    });

    expect(records.get('$root')).toMatchObject({
      threadRootId: '$root',
      absoluteIndex: 5,
      presentation: {
        rootPreviewText: 'Cached root preview',
        latestReplyPreviewText: 'Cached latest reply',
        lastSenderId: '@cached:server',
        messageCount: 3,
      },
      status: {
        replyCount: 3,
        isResolved: true,
        scheduledTaskCount: 2,
        lastActivityTs: 9000,
        tags: ['direct'],
      },
      cache: {
        eventCount: 3,
        oldestTs: 1000,
        newestTs: 9000,
        backwardToken: null,
        relationSnapshotComplete: true,
        tailLoaded: true,
        expectedReplyCount: 3,
      },
    });
  });
});
