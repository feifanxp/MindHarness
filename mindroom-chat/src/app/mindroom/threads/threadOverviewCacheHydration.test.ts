import { describe, expect, it } from 'vitest';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { ThreadRecord } from './types';
import {
  buildCachedOverviewCoverage,
  resolveFetchedRelationOverviewUpdate,
  resolveCachedOverviewUpdate,
} from './threadOverviewCacheHydration';

type RawCachedEvent = {
  event_id: string;
  origin_server_ts: number;
  sender?: string;
  content?: Record<string, unknown>;
  threadRootId?: string;
  relation?: { rel_type?: string; event_id?: string };
};

const makeEvent = (
  eventId: string,
  opts: {
    sender?: string;
    ts?: number;
    type?: string;
    content?: Record<string, unknown>;
    isThreadRoot?: boolean;
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
  } = {}
) =>
  ({
    isThreadRoot: opts.isThreadRoot ?? false,
    threadRootId: opts.threadRootId,
    getContent: () => opts.content ?? { body: eventId, msgtype: 'm.text' },
    getId: () => eventId,
    getRelation: () => opts.relation,
    getSender: () => opts.sender ?? '@alice:example.org',
    getTs: () => opts.ts ?? 0,
    getType: () => opts.type ?? 'm.room.message',
    getUnsigned: () => ({}),
    isRedacted: () => false,
    isRedaction: () => false,
    replacingEvent: () => undefined,
  } as MatrixEvent);

const makeRoom = (events: MatrixEvent[] = []): Room =>
  ({
    roomId: '!room:example.org',
    findEventById: (eventId: string) => events.find((event) => event.getId() === eventId),
    getMember: (userId: string) => ({ rawDisplayName: userId }),
    getThread: () => null,
    getUnfilteredTimelineSet: () => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    }),
  } as unknown as Room);

const mapRawCachedEvent = (rawEvent: IEvent): MatrixEvent => {
  const raw = rawEvent as RawCachedEvent;

  return makeEvent(raw.event_id, {
    content: raw.content,
    relation: raw.relation,
    sender: raw.sender,
    threadRootId: raw.threadRootId,
    ts: raw.origin_server_ts,
  }) as MatrixEvent;
};

const makeRecord = (overrides: Partial<ThreadRecord> = {}): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId: '$thread-root',
  rootEventId: '$thread-root',
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'root preview',
    latestReplyPreviewText: 'live reply',
    lastSenderId: '@live:example.org',
    lastSenderDisplayName: 'Live',
    messageCount: 5,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: 'root preview',
    recentThreadSummaryText: 'root preview',
    ...overrides.presentation,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 5,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: 100,
    tags: [],
    ...overrides.status,
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

describe('resolveCachedOverviewUpdate', () => {
  const cachedEditedRootPage = {
    rootEvent: {
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    },
    events: [
      {
        event_id: '$root-edit-v2',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: {
          body: '* cached v2',
          msgtype: 'm.text',
          'm.new_content': { body: 'cached v2', msgtype: 'm.text' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$thread-root' },
        },
      },
    ],
    hasMoreBefore: false,
  };

  it('uses a newer cached root edit over healthy-looking stale SDK text', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    });

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage: cachedEditedRootPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'live v1']]),
    });

    expect(update).toMatchObject({
      nextPreview: 'cached v2',
      nextPreviewSourceTs: 200,
    });
  });

  it('does not replace a newer live root edit with stale cache text', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 50,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'live v1', msgtype: 'm.text' },
    });
    liveRoot.makeReplaced(
      new MatrixEvent({
        event_id: '$root-edit-v3',
        origin_server_ts: 300,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: {
          body: '* live v3',
          msgtype: 'm.text',
          'm.new_content': { body: 'live v3', msgtype: 'm.text' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$thread-root' },
        },
      })
    );

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage: cachedEditedRootPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'live v3']]),
    });

    expect(update?.nextPreview).toBeUndefined();
    expect(update?.nextPreviewSourceTs).toBeUndefined();
  });

  it('uses complete cached text when newer live text is still a streaming placeholder', () => {
    const liveRoot = new MatrixEvent({
      event_id: '$thread-root',
      origin_server_ts: 300,
      sender: '@alice:example.org',
      type: 'm.room.message',
      content: { body: 'Thinking...  ⋯', msgtype: 'm.text' },
    });
    const cachedPage = {
      rootEvent: {
        event_id: '$thread-root',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        type: 'm.room.message',
        content: { body: 'cached complete', msgtype: 'm.text' },
      },
      events: [],
      hasMoreBefore: false,
    };

    const update = resolveCachedOverviewUpdate({
      rootId: '$thread-root',
      room: makeRoom([liveRoot]),
      mapper: (rawEvent) => new MatrixEvent(rawEvent),
      cachedPage,
      currentRootEvent: liveRoot,
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map([['$thread-root', 'Thinking...  ⋯']]),
    });

    expect(update).toMatchObject({
      nextPreview: 'cached complete',
      nextPreviewSourceTs: 200,
    });
  });

  it('uses the ThreadRecord snapshot to avoid downgrading from older cached reply metadata', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const room = makeRoom([rootEvent]);

    const update = resolveCachedOverviewUpdate({
      rootId: threadRootId,
      room,
      mapper: mapRawCachedEvent,
      cachedPage: {
        events: [
          {
            event_id: '$cached-reply',
            origin_server_ts: 90,
            sender: '@cached:example.org',
            content: { body: 'older cached reply', msgtype: 'm.text' },
            threadRootId,
            relation: { rel_type: 'm.thread', event_id: threadRootId },
          },
        ],
        hasMoreBefore: false,
      },
      currentRecord: makeRecord(),
      currentRootEvent: rootEvent,
      showCompactRoomView: false,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });

    expect(update).toMatchObject({
      rootId: threadRootId,
      nextCacheCoverage: {
        eventCount: 1,
        oldestTs: 90,
        newestTs: 90,
        hasMoreBackward: false,
        relationSnapshotComplete: false,
        tailLoaded: false,
      },
    });
    expect(update?.nextActivityTs).toBeUndefined();
    expect(update?.nextReplyPreviewText).toBeUndefined();
    expect(update?.nextLastSenderId).toBeUndefined();
    expect(update?.nextMessageCount).toBeUndefined();
  });

  it('derives ThreadRecord cache coverage from cached overview pages', () => {
    expect(
      buildCachedOverviewCoverage({
        events: [
          { event_id: '$a', origin_server_ts: 200 },
          { event_id: '$b', origin_server_ts: 100 },
        ],
        hasMoreBefore: true,
        beforeToken: 'older',
        expectedReplyCount: 7,
        relationSnapshotComplete: true,
        snapshotComplete: false,
        tailLoaded: true,
      })
    ).toMatchObject({
      eventCount: 2,
      oldestTs: 100,
      newestTs: 200,
      backwardToken: 'older',
      hasMoreBackward: true,
      expectedReplyCount: 7,
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    });
  });

  it('does not treat an empty cache miss as record coverage', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const room = makeRoom([rootEvent]);

    expect(
      resolveCachedOverviewUpdate({
        rootId: threadRootId,
        room,
        mapper: mapRawCachedEvent,
        cachedPage: {
          events: [],
          hasMoreBefore: false,
        },
        currentRecord: makeRecord(),
        currentRootEvent: rootEvent,
        showCompactRoomView: false,
        compactCachedThreadRootBodyMap: new Map(),
        compactThreadRootBodyMap: new Map(),
      })
    ).toBeNull();
  });

  it('projects freshly fetched relation events directly into overview metadata', () => {
    const threadRootId = '$thread-root';
    const rootEvent = makeEvent(threadRootId, { isThreadRoot: true, ts: 10 });
    const replyEvent = makeEvent('$fetched-reply', {
      content: { body: 'fresh fetched reply', msgtype: 'm.text' },
      relation: { rel_type: 'm.thread', event_id: threadRootId },
      sender: '@fetched:example.org',
      threadRootId,
      ts: 120,
    });
    const room = makeRoom([rootEvent, replyEvent]);

    const update = resolveFetchedRelationOverviewUpdate({
      rootId: threadRootId,
      room,
      events: [replyEvent],
      rootEvent,
      currentRecord: makeRecord({
        presentation: {
          latestReplyPreviewText: undefined,
          messageCount: 0,
        },
        status: {
          lastActivityTs: 10,
          replyCount: 0,
        },
      }),
      beforeToken: null,
      expectedReplyCount: 1,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(update).toMatchObject({
      rootId: threadRootId,
      nextActivityTs: 120,
      nextReplyPreviewText: 'fresh fetched reply',
      nextLastSenderId: '@fetched:example.org',
      nextMessageCount: 1,
      nextCacheCoverage: {
        eventCount: 1,
        oldestTs: 120,
        newestTs: 120,
        backwardToken: null,
        hasMoreBackward: false,
        expectedReplyCount: 1,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      },
    });
  });
});
