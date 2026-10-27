import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import {
  buildThreadParticipantMap,
  buildThreadReplyCountMap,
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
  findThreadRootEvent,
  getThreadReplyEventsForRoot,
  getPreferredVisibleThreadReplyEvents,
  getValidThreadRootEvent,
  getVisibleThreadMessageCount,
  getVisibleThreadParticipantIds,
  hasLoadedThreadReplyEvents,
  isVisibleThreadTextMessageEventType,
  isVisibleThreadReplyEvent,
  isVisibleThreadReplyEventType,
  isThreadReplyEvent,
} from './threadUtils';

const makeEvent = (
  eventId: string,
  threadRootId?: string,
  relationType?: string,
  senderId?: string,
  isThreadRoot = false,
  type = 'm.room.message'
) => ({
  getId: () => eventId,
  threadRootId,
  getRelation: () => (relationType ? { rel_type: relationType } : undefined),
  getSender: () => senderId,
  getType: () => type,
  isThreadRoot,
  isRedacted: () => false,
  isRedaction: () => false,
});

describe('eventBelongsToThread', () => {
  it('matches thread root events by event id', () => {
    expect(eventBelongsToThread(makeEvent('$root'), '$root')).toBe(true);
  });

  it('matches thread reply events by threadRootId', () => {
    expect(eventBelongsToThread(makeEvent('$reply', '$root'), '$root')).toBe(true);
  });

  it('does not match unrelated events', () => {
    expect(eventBelongsToThread(makeEvent('$other', '$different-root'), '$root')).toBe(false);
  });
});

describe('isThreadReplyEvent', () => {
  it('returns false for unthreaded events', () => {
    expect(isThreadReplyEvent('$event')).toBe(false);
  });

  it('returns false for thread root events associated to their own thread', () => {
    expect(isThreadReplyEvent('$root', '$root')).toBe(false);
  });

  it('returns true for thread reply events', () => {
    expect(isThreadReplyEvent('$reply', '$root')).toBe(true);
  });
});

describe('buildThreadReplyCountMap', () => {
  it('selects distinct replies for one root using the same SDK classification as counts', () => {
    const reply = makeEvent('$reply', '$root', RelationType.Thread);
    const classified = makeEvent('$classified', '$root');
    const events = [
      makeEvent('$root', '$root'),
      reply,
      makeEvent('$reply', '$root', RelationType.Thread),
      makeEvent('$foreign', '$other-root', RelationType.Thread),
      makeEvent('$edit', '$root', RelationType.Replace),
      makeEvent('$unthreaded'),
      classified,
    ];
    expect(getThreadReplyEventsForRoot(events, '$root')).toEqual([reply, classified]);
    expect(buildThreadReplyCountMap(events).get('$root')).toBe(2);
  });
  it('counts thread replies by root id', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$reply1', '$root', RelationType.Thread),
      makeEvent('$reply2', '$root', RelationType.Thread),
      makeEvent('$reply3', '$other-root', RelationType.Thread),
    ]);

    expect(counts.get('$root')).toBe(2);
    expect(counts.get('$other-root')).toBe(1);
  });

  it('ignores non-thread relation events', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$thread-reply', '$root', RelationType.Thread),
      makeEvent('$annotation', '$root', RelationType.Annotation),
      makeEvent('$edit', '$root', RelationType.Replace),
    ]);

    expect(counts.get('$root')).toBe(1);
  });

  it('deduplicates repeated events by event id', () => {
    const duplicateReply = makeEvent('$reply', '$root', RelationType.Thread);
    const counts = buildThreadReplyCountMap([duplicateReply, duplicateReply]);

    expect(counts.get('$root')).toBe(1);
  });
});

describe('isVisibleThreadReplyEventType', () => {
  it('accepts renderable threaded text message event types', () => {
    expect(isVisibleThreadTextMessageEventType('m.room.message')).toBe(true);
    expect(isVisibleThreadTextMessageEventType('m.room.encrypted')).toBe(true);
    expect(isVisibleThreadTextMessageEventType('com.mindroom.thread.tag')).toBe(false);
  });

  it('accepts supported visible threaded event types', () => {
    expect(isVisibleThreadReplyEventType('m.room.message')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.room.encrypted')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.sticker')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.room.topic')).toBe(true);
    expect(isVisibleThreadReplyEventType('io.mindroom.tool_approval')).toBe(true);
  });

  it('rejects metadata-only threaded relation types', () => {
    expect(isVisibleThreadReplyEventType('com.mindroom.thread.tag')).toBe(false);
  });
});

describe('isVisibleThreadReplyEvent', () => {
  it('accepts visible threaded replies', () => {
    expect(
      isVisibleThreadReplyEvent(
        makeEvent('$reply', '$root', RelationType.Thread, '@alice:example.org')
      )
    ).toBe(true);
  });

  it('rejects threaded metadata events that do not render in the timeline', () => {
    expect(
      isVisibleThreadReplyEvent(
        makeEvent(
          '$thread-tag',
          '$root',
          RelationType.Thread,
          '@alice:example.org',
          false,
          'com.mindroom.thread.tag'
        )
      )
    ).toBe(false);
  });
});

describe('buildVisibleThreadReplyCountMap', () => {
  it('counts only visible threaded replies', () => {
    const counts = buildVisibleThreadReplyCountMap([
      makeEvent('$reply-1', '$root', RelationType.Thread),
      makeEvent(
        '$thread-tag-1',
        '$root',
        RelationType.Thread,
        '@alice:example.org',
        false,
        'com.mindroom.thread.tag'
      ),
      makeEvent('$reply-2', '$root', RelationType.Thread),
    ]);

    expect(counts.get('$root')).toBe(2);
  });
});

describe('getPreferredVisibleThreadReplyEvents', () => {
  it('prefers loaded events over timeline fallback and filters hidden thread metadata', () => {
    const visibleReply = makeEvent('$reply-1', '$root', RelationType.Thread);
    const hiddenReply = makeEvent(
      '$thread-tag',
      '$root',
      RelationType.Thread,
      '@alice:example.org',
      false,
      'com.mindroom.thread.tag'
    );
    const timelineReply = makeEvent('$reply-2', '$root', RelationType.Thread);

    const replyEvents = getPreferredVisibleThreadReplyEvents({
      events: [visibleReply, hiddenReply],
      timeline: [timelineReply],
    });

    expect(replyEvents).toEqual([visibleReply]);
  });
});

describe('hasLoadedThreadReplyEvents', () => {
  it('returns true when the thread has loaded events or timeline entries', () => {
    expect(hasLoadedThreadReplyEvents({ events: [makeEvent('$reply', '$root')] })).toBe(true);
    expect(hasLoadedThreadReplyEvents({ timeline: [makeEvent('$reply', '$root')] })).toBe(true);
  });

  it('returns false for empty or missing reply collections', () => {
    expect(hasLoadedThreadReplyEvents({ events: [], timeline: [] })).toBe(false);
    expect(hasLoadedThreadReplyEvents(undefined)).toBe(false);
  });
});

describe('getVisibleThreadMessageCount', () => {
  it('counts only visible loaded replies', () => {
    expect(
      getVisibleThreadMessageCount({
        events: [
          makeEvent('$reply-1', '$root', RelationType.Thread),
          makeEvent(
            '$thread-tag',
            '$root',
            RelationType.Thread,
            '@alice:example.org',
            false,
            'com.mindroom.thread.tag'
          ),
        ],
      })
    ).toBe(1);
  });

  it('returns zero when a loaded thread only contains hidden metadata relations', () => {
    expect(
      getVisibleThreadMessageCount({
        events: [
          makeEvent(
            '$thread-tag',
            '$root',
            RelationType.Thread,
            '@alice:example.org',
            false,
            'com.mindroom.thread.tag'
          ),
        ],
      })
    ).toBe(0);
  });

  it('falls back to sdk or bundled counts when replies are not loaded yet', () => {
    expect(getVisibleThreadMessageCount({ length: 3 })).toBe(3);
    expect(getVisibleThreadMessageCount(undefined, 2)).toBe(2);
  });

  const makeSdkThread = (
    events: ReturnType<typeof makeEvent>[],
    { length, initialEventsFetched = true }: { length: number; initialEventsFetched?: boolean }
  ) =>
    ({
      id: '$root',
      events,
      timeline: events,
      length,
      initialEventsFetched,
    } as unknown as Parameters<typeof getVisibleThreadMessageCount>[0]);

  it('does not let a partly loaded thread hide its total count', () => {
    const replies = [
      makeEvent('$reply-1', '$root', RelationType.Thread),
      makeEvent('$reply-2', '$root', RelationType.Thread),
    ];

    // Each window holds as many replies as the SDK counts; only the missing root or first page shows it is partial.
    expect(getVisibleThreadMessageCount(makeSdkThread(replies, { length: 2 }), 24)).toBe(24);
    expect(
      getVisibleThreadMessageCount(
        makeSdkThread([makeEvent('$root'), ...replies], { length: 2, initialEventsFetched: false }),
        24
      )
    ).toBe(24);
    expect(getVisibleThreadMessageCount({ events: replies, timeline: replies }, 24)).toBe(24);
  });

  describe('with an SDK thread', () => {
    const roomId = '!room:example.org';
    const message = (eventId: string, ts: number, content = {}) => ({
      event_id: eventId,
      room_id: roomId,
      sender: '@agent:example.org',
      type: 'm.room.message',
      origin_server_ts: ts,
      content: { msgtype: 'm.text', body: eventId, ...content },
    });
    const reply = (index: number) =>
      message(`$reply-${index}`, index * 10, {
        'm.relates_to': { rel_type: RelationType.Thread, event_id: '$root' },
      });
    const edit = (index: number) =>
      message(`$edit-${index}`, index * 10 + 1, {
        body: '* edited',
        'm.new_content': { msgtype: 'm.text', body: 'edited' },
        'm.relates_to': { rel_type: 'm.replace', event_id: `$reply-${index}` },
      });
    /** An unopened listed thread whose server reports `count` replies; `pages` answer its /relations requests. */
    const listedThread = (count: number, pages: { chunk: object[]; next_batch?: string }[]) => {
      const root = {
        ...message('$root', 0),
        unsigned: { 'm.relations': { 'm.thread': { count, latest_event: reply(count) } } },
      };
      const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
      vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
      vi.spyOn(mx, 'fetchRoomEvent').mockResolvedValue(root as never);
      const fetchRelations = vi.spyOn(mx, 'fetchRelations');
      pages.forEach((page) => fetchRelations.mockResolvedValueOnce(page as never));
      const room = new Room(roomId, mx, '@alice:example.org', { timelineSupport: true });
      mx.store.storeRoom(room);
      room.processThreadRoots([mx.getEventMapper()(root)], true);
      return { mx, room, thread: room.getThread('$root')! };
    };
    const ids = (thread: Thread) => thread.events.map((event) => event.getId());

    let serverSideSupport: FeatureSupport;
    beforeEach(() => {
      serverSideSupport = Thread.hasServerSideSupport;
      Thread.hasServerSideSupport = FeatureSupport.Stable;
    });
    afterEach(() => {
      Thread.hasServerSideSupport = serverSideSupport;
      vi.restoreAllMocks();
    });

    it('counts the loaded replies exactly once back-pagination loads the whole thread', async () => {
      const { mx, room, thread } = listedThread(3, [
        { chunk: [reply(3)], next_batch: 'older' },
        { chunk: [reply(2), reply(1)] },
      ]);

      await thread.initialize();
      expect(ids(thread)).toEqual(['$reply-3']);
      expect(getVisibleThreadMessageCount(thread)).toBe(3);

      await mx.paginateEventTimeline(thread.liveTimeline, { backwards: true });
      expect(ids(thread)).toEqual(['$root', '$reply-1', '$reply-2', '$reply-3']);
      expect(getVisibleThreadMessageCount(thread, 5)).toBe(3);

      room.addLiveEvents(
        [
          mx.getEventMapper()({
            ...message('$redaction', 100),
            type: 'm.room.redaction',
            redacts: '$reply-2',
            content: { redacts: '$reply-2' },
          }),
        ],
        { addToState: false }
      );
      expect(getVisibleThreadMessageCount(thread, 5)).toBe(2);
    });

    it('does not count edits as replies when deciding the thread is fully loaded', async () => {
      const { mx, thread } = listedThread(5, [
        { chunk: [edit(5), reply(5), edit(4), reply(4)], next_batch: 'older' },
        { chunk: [edit(1), reply(1)] },
      ]);
      await thread.initialize();
      thread.liveTimeline.setPaginationToken('cache-cursor', Direction.Backward);

      await mx.paginateEventTimeline(thread.liveTimeline, { backwards: true });

      expect(ids(thread)).toEqual([
        '$root',
        '$reply-1',
        '$edit-1',
        '$reply-4',
        '$edit-4',
        '$reply-5',
        '$edit-5',
      ]);
      expect(getVisibleThreadMessageCount(thread)).toBe(5);
    });
  });
});

describe('buildThreadParticipantMap', () => {
  it('returns recent unique participants per thread root', () => {
    const participants = buildThreadParticipantMap([
      makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply2', '$root', RelationType.Thread, '@bob:example.org'),
      makeEvent('$reply3', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply4', '$root', RelationType.Thread, '@carol:example.org'),
    ]);

    expect(participants.get('$root')).toEqual([
      '@carol:example.org',
      '@alice:example.org',
      '@bob:example.org',
    ]);
  });

  it('skips non-thread relations and events without sender', () => {
    const participants = buildThreadParticipantMap([
      makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$annotation', '$root', RelationType.Annotation, '@bob:example.org'),
      makeEvent('$reply2', '$root', RelationType.Thread, undefined),
    ]);

    expect(participants.get('$root')).toEqual(['@alice:example.org']);
  });

  it('limits participants per thread root', () => {
    const participants = buildThreadParticipantMap(
      [
        makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
        makeEvent('$reply2', '$root', RelationType.Thread, '@bob:example.org'),
        makeEvent('$reply3', '$root', RelationType.Thread, '@carol:example.org'),
      ],
      2
    );

    expect(participants.get('$root')).toEqual(['@carol:example.org', '@bob:example.org']);
  });
});

describe('buildVisibleThreadParticipantMap', () => {
  it('ignores non-renderable threaded metadata relations when collecting participants', () => {
    const participants = buildVisibleThreadParticipantMap([
      makeEvent(
        '$thread-tag',
        '$root',
        RelationType.Thread,
        '@tagger:example.org',
        false,
        'com.mindroom.thread.tag'
      ),
      makeEvent('$reply-1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply-2', '$root', RelationType.Thread, '@bob:example.org'),
    ]);

    expect(participants.get('$root')).toEqual(['@bob:example.org', '@alice:example.org']);
  });
});

describe('getVisibleThreadParticipantIds', () => {
  it('returns recent visible reply senders and falls back to the root sender', () => {
    expect(
      getVisibleThreadParticipantIds(
        {
          events: [
            makeEvent('$reply-1', '$root', RelationType.Thread, '@alice:example.org'),
            makeEvent(
              '$thread-tag',
              '$root',
              RelationType.Thread,
              '@tagger:example.org',
              false,
              'com.mindroom.thread.tag'
            ),
            makeEvent('$reply-2', '$root', RelationType.Thread, '@bob:example.org'),
          ],
        },
        makeEvent('$root', undefined, undefined, '@carol:example.org')
      )
    ).toEqual(['@bob:example.org', '@alice:example.org', '@carol:example.org']);
  });
});

describe('getValidThreadRootEvent', () => {
  it('returns the known thread root when the SDK has a thread model', () => {
    const rootEvent = makeEvent('$root', undefined, undefined, undefined, true);
    const room = {
      findEventById: () => undefined,
      getThread: () => ({
        rootEvent,
      }),
    };

    expect(getValidThreadRootEvent(room as never, '$root')).toBe(rootEvent);
  });

  it('rejects arbitrary non-thread-root events from the room timeline', () => {
    const nonThreadRootEvent = makeEvent('$bogus');
    const room = {
      findEventById: () => nonThreadRootEvent,
      getThread: () => null,
    };

    expect(getValidThreadRootEvent(room as never, '$bogus')).toBeUndefined();
  });
});

describe('findThreadRootEvent', () => {
  it('reads the room timeline, then the root thread, without scanning every thread', () => {
    const inRoom = { id: 'room-copy' };
    const inThread = { id: 'thread-copy' };
    const findEventById = vi.fn();
    const room = {
      findEventById,
      getUnfilteredTimelineSet: () => ({
        findEventById: (id: string) => (id === '$loaded' ? inRoom : undefined),
      }),
      getThread: (id: string) =>
        id === '$threaded' ? { findEventById: () => inThread } : undefined,
    };

    expect(findThreadRootEvent(room as never, '$loaded')).toBe(inRoom);
    expect(findThreadRootEvent(room as never, '$threaded')).toBe(inThread);
    expect(findThreadRootEvent(room as never, '$unknown')).toBeUndefined();
    expect(findEventById).not.toHaveBeenCalled();
  });
});
