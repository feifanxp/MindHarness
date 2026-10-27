import { MatrixEvent, RelationType, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCacheHealthForTesting } from './cacheHealth';
import {
  collectLegacyStandaloneReplaceIds,
  collectStateTargetEvents,
  createPreferLiveEventMapper,
  loadThreadCachedPaginationSnapshot,
  loadThreadCachedSnapshot,
  loadRoomCachedBackStateSnapshot,
  loadRoomCachedPaginationSnapshot,
  loadLatestRoomCacheHydrationSnapshot,
  loadCachedThreadSnapshot,
  persistThreadCacheFromRoomEventsSnapshot,
  persistRoomEventCacheSnapshot,
  persistThreadEventCacheSnapshot,
  serializeRoomCacheEvents,
  serializeThreadCacheEvents,
} from './eventRepository';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';

const makeRawMessage = (
  eventId: string,
  body: string,
  opts: { sender?: string; ts?: number; replacement?: Partial<IEvent> } = {}
): Partial<IEvent> => ({
  event_id: eventId,
  room_id: '!room:example.org',
  sender: opts.sender ?? '@alice:example.org',
  type: 'm.room.message',
  origin_server_ts: opts.ts ?? 100,
  content: { msgtype: 'm.text', body },
  ...(opts.replacement
    ? { unsigned: { 'm.relations': { [RelationType.Replace]: opts.replacement } } }
    : {}),
});

const makeRawEdit = (
  eventId: string,
  targetId: string,
  body: string,
  opts: { sender?: string; ts?: number } = {}
): Partial<IEvent> => ({
  event_id: eventId,
  room_id: '!room:example.org',
  sender: opts.sender ?? '@alice:example.org',
  type: 'm.room.message',
  origin_server_ts: opts.ts ?? 200,
  content: {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: targetId },
  },
});

const mapRawEvent = (rawEvent: Partial<IEvent>): MatrixEvent => new MatrixEvent(rawEvent as IEvent);

const makeSdkStyleMapper = (live: MatrixEvent) =>
  vi.fn((rawEvent: Partial<IEvent>): MatrixEvent => {
    if (rawEvent.event_id !== live.getId()) return mapRawEvent(rawEvent);

    live.setUnsigned({ ...live.getUnsigned(), ...rawEvent.unsigned });
    const replacement = (
      rawEvent.unsigned?.['m.relations'] as Record<string, Partial<IEvent>> | undefined
    )?.[RelationType.Replace];
    if (replacement) live.makeReplaced(mapRawEvent(replacement));
    return live;
  });

describe('eventRepository same-id revision merge', () => {
  it('upgrades an SDK-owned event from a newer cached same-sender replacement', () => {
    const live = mapRawEvent(makeRawMessage('$target', 'v1'));
    const edit = makeRawEdit('$edit-v2', '$target', 'v2');
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };
    const mapEvent = vi.fn(mapRawEvent);
    const preferLive = createPreferLiveEventMapper(room as never, mapEvent);

    const merged = preferLive(makeRawMessage('$target', 'v1', { replacement: edit }));

    expect(merged).toBe(live);
    // The live event never goes through the mapper (its reuse branch would
    // poison the mapper's preventReEmit flag); only the fresh edit is mapped.
    expect(mapEvent).toHaveBeenCalledTimes(1);
    expect(mapEvent.mock.calls[0]?.[0]).toMatchObject({ event_id: '$edit-v2' });
    expect(merged.replacingEvent()?.getId()).toBe('$edit-v2');
    expect(merged.replacingEvent()?.getContent()['m.new_content']).toMatchObject({ body: 'v2' });
  });

  it('never downgrades a newer serialized live replacement to an older cached one', () => {
    const liveEdit = makeRawEdit('$edit-v3', '$target', 'v3', { ts: 300 });
    const cachedEdit = makeRawEdit('$edit-v2', '$target', 'v2', { ts: 200 });
    const live = mapRawEvent(makeRawMessage('$target', 'v1', { replacement: liveEdit }));
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };

    const merged = createPreferLiveEventMapper(
      room as never,
      mapRawEvent
    )(makeRawMessage('$target', 'v1', { replacement: cachedEdit }));

    expect(merged).toBe(live);
    expect(merged.replacingEvent()?.getId()).toBe('$edit-v3');
    expect(merged.getContent()).toMatchObject({ body: 'v3' });
  });

  it('never routes the live event through the SDK mapper, so its eager bundle apply cannot downgrade', () => {
    const liveEdit = makeRawEdit('$edit-v3', '$target', 'v3', { ts: 300 });
    const cachedEdit = makeRawEdit('$edit-v2', '$target', 'v2', { ts: 200 });
    const live = mapRawEvent(makeRawMessage('$target', 'v1', { replacement: liveEdit }));
    live.makeReplaced(mapRawEvent(liveEdit));
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };
    const sdkStyleMap = makeSdkStyleMapper(live);
    const incoming = makeRawMessage('$target', 'v1', { replacement: cachedEdit });
    const incomingRelations = incoming.unsigned?.['m.relations'] as Record<string, unknown>;
    incomingRelations[RelationType.Thread] = { count: 7 };

    const merged = createPreferLiveEventMapper(room as never, sdkStyleMap)(incoming);

    expect(merged).toBe(live);
    expect(sdkStyleMap).not.toHaveBeenCalledWith(expect.objectContaining({ event_id: '$target' }));
    expect(merged.replacingEvent()?.getId()).toBe('$edit-v3');
    expect(merged.getContent()).toMatchObject({ body: 'v3' });
    expect(merged.getUnsigned()['m.relations']?.[RelationType.Thread]).toEqual({ count: 7 });
  });

  it('preserves newer live relation bundles while adding disjoint incoming bundles', () => {
    const liveEdit = makeRawEdit('$edit-v3', '$target', 'v3', { ts: 300 });
    const cachedEdit = makeRawEdit('$edit-v2', '$target', 'v2', { ts: 200 });
    const live = mapRawEvent(makeRawMessage('$target', 'v1', { replacement: liveEdit }));
    live.setUnsigned({
      'm.relations': {
        [RelationType.Replace]: liveEdit,
        [RelationType.Thread]: { count: 9 },
        [RelationType.Annotation]: { chunk: [{ key: 'live' }] },
      },
    });
    live.makeReplaced(mapRawEvent(liveEdit));
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };
    const sdkStyleMap = makeSdkStyleMapper(live);
    const incoming = makeRawMessage('$target', 'v1', { replacement: cachedEdit });
    incoming.unsigned = {
      'm.relations': {
        [RelationType.Replace]: cachedEdit,
        [RelationType.Thread]: { count: 1 },
        [RelationType.Reference]: { chunk: [{ event_id: '$incoming-reference' }] },
      },
    };

    createPreferLiveEventMapper(room as never, sdkStyleMap)(incoming);

    const relations = live.getUnsigned()['m.relations'];
    expect(relations?.[RelationType.Thread]).toEqual({ count: 9 });
    expect(relations?.[RelationType.Annotation]).toEqual({ chunk: [{ key: 'live' }] });
    expect(relations?.[RelationType.Reference]).toEqual({
      chunk: [{ event_id: '$incoming-reference' }],
    });
    expect(live.replacingEvent()?.getId()).toBe('$edit-v3');
  });

  it('clears a private replacement when the incoming same-id bundle proves it was redacted', () => {
    const live = mapRawEvent(makeRawMessage('$target', 'original'));
    const edit = mapRawEvent(makeRawEdit('$edit-v2', '$target', 'secret', { ts: 200 }));
    live.makeReplaced(edit);
    const redactedEdit = {
      ...makeRawEdit('$edit-v2', '$target', 'secret', { ts: 200 }),
      content: {},
      unsigned: {
        redacted_because: {
          event_id: '$redaction',
          room_id: '!room:example.org',
          sender: '@moderator:example.org',
          type: 'm.room.redaction',
          origin_server_ts: 300,
          redacts: '$edit-v2',
          content: {},
        },
      },
    } satisfies Partial<IEvent>;
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };

    createPreferLiveEventMapper(
      room as never,
      mapRawEvent
    )(makeRawMessage('$target', 'original', { replacement: redactedEdit }));

    expect(live.replacingEvent()).toBeNull();
    expect(live.getUnsigned()['m.relations']?.[RelationType.Replace]).toBeUndefined();
    expect(JSON.stringify(live.event)).not.toContain('secret');
  });

  it('does not re-persist a stale authoritative bundle for a known-redacted edit', () => {
    const edit = makeRawEdit('$edit-v2', '$target', 'secret');
    const targetRaw = makeRawMessage('$target', 'original', { replacement: edit });
    const redactedEdit = mapRawEvent(edit);
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$edit-v2' ? redactedEdit : undefined),
    };
    redactedEdit.makeRedacted(
      mapRawEvent({
        event_id: '$redaction',
        room_id: room.roomId,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        origin_server_ts: 300,
        redacts: '$edit-v2',
        content: {},
      }),
      room as never
    );

    const snapshot = persistThreadEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      threadId: '$root',
      events: [mapRawEvent(targetRaw)],
      authoritativeRawEvents: [targetRaw],
      save: vi.fn().mockResolvedValue(true),
    });

    expect(snapshot.rawEvents[0]?.unsigned?.['m.relations']?.['m.replace']).toBeUndefined();
    expect(JSON.stringify(snapshot.rawEvents)).not.toContain('secret');
  });

  it('compacts an authoritative same-sender replace into its target record', () => {
    const target = makeRawMessage('$target', 'original', { ts: 100 });
    const replace = makeRawEdit('$edit-v2', '$target', 'final content', { ts: 200 });
    const room = makeRoom({ liveEvents: [] });

    const snapshot = persistThreadEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      threadId: '$root',
      events: [mapRawEvent(target), mapRawEvent(replace)],
      authoritativeRawEvents: [target, replace],
      save: vi.fn().mockResolvedValue(true),
    });

    expect(snapshot.rawEvents).toHaveLength(1);
    expect(snapshot.rawEvents[0]).toMatchObject({
      event_id: '$target',
      unsigned: {
        'm.relations': {
          [RelationType.Replace]: {
            event_id: '$edit-v2',
            content: { 'm.new_content': { body: 'final content' } },
          },
        },
      },
    });
  });

  it('clears a known-redacted live replacement even when the incoming target has no bundle', () => {
    const live = mapRawEvent(makeRawMessage('$target', 'original'));
    const edit = mapRawEvent(makeRawEdit('$edit-v2', '$target', 'secret'));
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) =>
        eventId === '$target' ? live : eventId === '$edit-v2' ? edit : undefined,
    };
    live.makeReplaced(edit);
    edit.makeRedacted(
      mapRawEvent({
        event_id: '$redaction',
        room_id: room.roomId,
        sender: '@moderator:example.org',
        type: 'm.room.redaction',
        origin_server_ts: 300,
        redacts: '$edit-v2',
        content: {},
      }),
      room as never
    );

    createPreferLiveEventMapper(room as never, mapRawEvent)(makeRawMessage('$target', 'original'));

    expect(live.replacingEvent()).toBeNull();
  });

  it('does not apply a cross-sender cached replacement', () => {
    const live = mapRawEvent(makeRawMessage('$target', 'v1'));
    const edit = makeRawEdit('$evil-edit', '$target', 'evil', {
      sender: '@mallory:example.org',
    });
    const room = {
      roomId: '!room:example.org',
      findEventById: () => live,
    };

    createPreferLiveEventMapper(
      room as never,
      mapRawEvent
    )(makeRawMessage('$target', 'v1', { replacement: edit }));

    expect(live.replacingEvent()).toBeNull();
  });

  it('prunes a redacted raw event even when no live SDK instance exists', () => {
    const room = makeRoom({ liveEvents: [] });
    const redactedBecause = {
      event_id: '$redaction',
      origin_server_ts: 200,
      sender: '@alice:example.org',
      type: 'm.room.redaction',
      redacts: '$target',
      content: {},
    };
    const rawEvent = {
      ...makeRawMessage('$target', 'plaintext that must not be cached'),
      unsigned: { redacted_because: redactedBecause },
    };

    const mapped = createPreferLiveEventMapper(room as never, mapRawEvent)(rawEvent);

    expect(mapped.isRedacted()).toBe(true);
    expect(mapped.event.content).toEqual({});
    expect(mapped.event.unsigned?.redacted_because).toMatchObject({
      event_id: '$redaction',
    });
  });
});

describe('eventRepository cache serialization helpers', () => {
  it('adds replacement and redaction targets before cache serialization', () => {
    const targetEvent = makeEvent('$target', { ts: 100, content: { body: 'target' } });
    const editEvent = makeEvent('$edit', {
      associatedId: '$target',
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
      ts: 200,
    });
    const redactionEvent = makeEvent('$redaction', {
      associatedId: '$target',
      isRedaction: true,
      ts: 300,
    });
    const room = makeRoom({ liveEvents: [targetEvent] });

    expect(
      collectStateTargetEvents(room as never, [editEvent, redactionEvent] as never).map((event) =>
        event.getId()
      )
    ).toEqual(['$edit', '$target', '$redaction']);
  });

  // CINNY-207 P1.2/P1.4 interplay (round-1 review fix): the redaction
  // lifecycle DELETES a redacted reaction's records; expanding the pruned
  // reaction back into the persist batch here would re-insert the record
  // the same handler just deleted.
  it('does not pull redacted reaction targets back into the persist batch', () => {
    const reactionEvent = makeEvent('$reaction', { ts: 100, type: 'm.reaction' });
    const redactionEvent = makeEvent('$redaction', {
      associatedId: '$reaction',
      isRedaction: true,
      ts: 200,
    });
    const room = makeRoom({ liveEvents: [reactionEvent] });

    expect(
      collectStateTargetEvents(room as never, [redactionEvent] as never).map((event) =>
        event.getId()
      )
    ).toEqual(['$redaction']);
  });

  it('serializes room cache payloads without thread-only activity', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const roomEvent = makeEvent('$room', { ts: 300, content: { body: 'room' } });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent, roomEvent] });

    expect(
      serializeRoomCacheEvents(room as never, [rootEvent, replyEvent, roomEvent] as never).map(
        (event) => event.event_id
      )
    ).toEqual(['$root', '$room']);
  });

  it('serializes thread cache payloads with the root event first when provided', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });

    expect(
      serializeThreadCacheEvents(room as never, [replyEvent] as never, rootEvent as never).map(
        (event) => event.event_id
      )
    ).toEqual(['$root', '$reply']);
  });
});

describe('eventRepository cache persistence snapshots', () => {
  it('persists thread cache snapshots with a derived complete reply count', () => {
    const rootEvent = makeEvent('$root', {
      ts: 100,
      isThreadRoot: true,
      content: { body: 'root' },
    });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });
    const writes: unknown[][] = [];

    const snapshot = persistThreadEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      threadId: '$root',
      events: [replyEvent] as never,
      rootEvent: rootEvent as never,
      beforeTokenForEarliest: null,
      tailLoaded: true,
      snapshotComplete: true,
      save: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshot.loadedReplyCount).toBe(1);
    expect(snapshot.expectedReplyCount).toBe(1);
    expect(snapshot.rawEvents.map((event) => event.event_id)).toEqual(['$root', '$reply']);
    expect(snapshot.rawRootEvent?.event_id).toBe('$root');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      '$root',
      [{ event_id: '$root' }, { event_id: '$reply' }],
      { event_id: '$root' },
      null,
      true,
      true,
      1,
      undefined,
    ]);
  });

  it('persists room cache snapshots without thread-only replies', () => {
    const rootEvent = makeEvent('$root', { ts: 100, content: { body: 'root' } });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const roomEvent = makeEvent('$room', { ts: 300, content: { body: 'room' } });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent, roomEvent] });
    const writes: unknown[][] = [];

    const snapshot = persistRoomEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [rootEvent, replyEvent, roomEvent] as never,
      beforeTokenForEarliest: 'before-root',
      save: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshot.rawEvents.map((event) => event.event_id)).toEqual(['$root', '$room']);
    expect(snapshot.sourceEventCount).toBe(3);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      [{ event_id: '$root' }, { event_id: '$room' }],
      'before-root',
    ]);
  });

  it('persists thread cache snapshots derived from room events and updates open seeds', () => {
    const rootEvent = makeEvent('$root', {
      ts: 100,
      isThreadRoot: true,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const replyEvent = makeEvent('$reply', {
      threadRootId: '$root',
      ts: 200,
      content: { body: 'reply' },
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });
    const writes: unknown[][] = [];
    const savedSeeds: MatrixEvent[][] = [];

    const snapshots = persistThreadCacheFromRoomEventsSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [replyEvent] as never,
      opts: {
        roomStartKnown: true,
        roomTailLoaded: true,
      },
      getSeedSnapshot: () => [],
      saveSeedSnapshot: (_room, _threadId, events) => {
        savedSeeds.push(events);
      },
      saveThreadSnapshot: (...args) => {
        writes.push(args);
        return Promise.resolve();
      },
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].threadId).toBe('$root');
    expect(snapshots[0].nextSeedEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(snapshots[0].roomDerivedSnapshot).toMatchObject({
      beforeTokenForEarliest: null,
      expectedReplyCount: 1,
      loadedReplyCount: 1,
      snapshotComplete: true,
      tailLoaded: true,
    });
    expect(snapshots[0].cacheSnapshot.expectedReplyCount).toBe(1);
    expect(savedSeeds[0].map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject([
      'session',
      room.roomId,
      '$root',
      [{ event_id: '$root' }, { event_id: '$reply' }],
      { event_id: '$root' },
      null,
      true,
      true,
      1,
      undefined,
    ]);
  });
});

describe('eventRepository cached thread snapshots', () => {
  it('first-paints the newer cached replacement onto an overlapping SDK thread event', async () => {
    const live = mapRawEvent(makeRawMessage('$reply', 'v1', { ts: 200 }));
    const edit = makeRawEdit('$edit-v2', '$reply', 'v2', { ts: 300 });
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$reply' ? live : undefined),
    };

    const snapshot = await loadThreadCachedSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 50,
      maxPages: 1,
      mapEvent: createPreferLiveEventMapper(room as never, mapRawEvent),
      loadLatest: async () => ({
        events: [makeRawMessage('$reply', 'v1', { ts: 200, replacement: edit })],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot?.events).toEqual([live]);
    expect(live.replacingEvent()?.getId()).toBe('$edit-v2');
  });

  it('loads and stitches cached thread pages from newest to oldest', async () => {
    const rootEvent = { event_id: '$root', origin_server_ts: 10 };
    const newerReply = { event_id: '$newer', origin_server_ts: 30 };
    const olderReply = { event_id: '$older', origin_server_ts: 20 };
    const loadedPageIndexes: number[] = [];

    const snapshot = await loadCachedThreadSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 2,
      maxPages: 5,
      loadLatest: async () => ({
        rootEvent,
        events: [newerReply],
        hasMoreBefore: true,
        beforeToken: 'before-newer',
        expectedReplyCount: 2,
        snapshotComplete: true,
        relationSnapshotComplete: true,
        tailLoaded: true,
      }),
      loadBefore: async (_sessionId, _roomId, _threadId, anchor) => {
        expect(anchor).toEqual({ eventId: '$newer', ts: 30 });
        return {
          events: [olderReply],
          hasMoreBefore: false,
          beforeToken: null,
        };
      },
      onPage: (_page, pageIndex) => {
        loadedPageIndexes.push(pageIndex);
      },
    });

    expect(snapshot.events.map((event) => event.event_id)).toEqual(['$older', '$newer']);
    expect(snapshot.rootEvent).toBe(rootEvent);
    expect(snapshot.beforeToken).toBeNull();
    expect(snapshot.hasMoreBefore).toBe(false);
    expect(snapshot.expectedReplyCount).toBe(2);
    expect(snapshot.snapshotComplete).toBe(true);
    expect(snapshot.relationSnapshotComplete).toBe(true);
    expect(snapshot.tailLoaded).toBe(true);
    expect(loadedPageIndexes).toEqual([1, 2]);
  });

  it('loads mapped cached thread snapshot events in normalized order', async () => {
    const snapshot = await loadThreadCachedSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 50,
      maxPages: 5,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        rootEvent: { event_id: '$root', origin_server_ts: 100 },
        events: [{ event_id: '$reply', origin_server_ts: 200 }],
        hasMoreBefore: false,
        beforeToken: null,
        expectedReplyCount: 1,
        snapshotComplete: true,
        relationSnapshotComplete: true,
        tailLoaded: true,
      }),
    });

    expect(snapshot?.events.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(snapshot?.cachedPage.beforeToken).toBeNull();
    expect(snapshot?.expectedReplyCount).toBe(1);
    expect(snapshot?.snapshotComplete).toBe(true);
    expect(snapshot?.relationSnapshotComplete).toBe(true);
    expect(snapshot?.tailLoaded).toBe(true);
  });

  it('loads mapped cached thread pagination events from the requested anchor', async () => {
    const earliestLoadedReply = makeEvent('$loaded', {
      ts: 300,
      threadRootId: '$root',
    });

    const snapshot = await loadThreadCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      earliestLoadedReply: earliestLoadedReply as never,
      limit: 50,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadBefore: async (_sessionId, _roomId, threadId, anchor, limit) => {
        expect(threadId).toBe('$root');
        expect(anchor).toEqual({ eventId: '$loaded', ts: 300 });
        expect(limit).toBe(50);
        return {
          rootEvent: { event_id: '$root', origin_server_ts: 100 },
          events: [{ event_id: '$older-reply', origin_server_ts: 200 }],
          hasMoreBefore: true,
          beforeToken: 'before-older-reply',
        };
      },
    });

    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$root', '$older-reply']);
    expect(snapshot.beforeToken).toBe('before-older-reply');
    expect(snapshot.hasMoreCachedBack).toBe(true);
  });

  it('reports a root-only cached page as a cache-miss so the network leg runs', async () => {
    // The cache-store loaders return the thread root alongside EVERY page —
    // including an empty one — and normalizeCachedThreadEvents folds it into
    // the mapped events. The root is always already rendered at index 0, so
    // judging hit/miss on the mapped list made a root-only page an eternal
    // barren "cache-hit": each pagination gesture committed nothing new and
    // the network fetch of genuinely older events never fired (found by the
    // ios-momentum-invariants prepend one-paint e2e).
    const earliestLoadedReply = makeEvent('$loaded', {
      ts: 300,
      threadRootId: '$root',
    });

    const snapshot = await loadThreadCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      earliestLoadedReply: earliestLoadedReply as never,
      limit: 50,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadBefore: async () => ({
        rootEvent: { event_id: '$root', origin_server_ts: 100 },
        events: [],
        hasMoreBefore: false,
        beforeToken: 'lingering-token',
      }),
    });

    expect(snapshot.status).toBe('cache-miss');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$root']);
  });
});

describe('eventRepository latest room cache hydration snapshots', () => {
  it('hydrates an overlapping same-id event when cache has a newer replacement', async () => {
    const live = mapRawEvent(makeRawMessage('$target', 'v1', { ts: 100 }));
    const edit = makeRawEdit('$edit-v2', '$target', 'v2', { ts: 200 });
    const room = {
      roomId: '!room:example.org',
      findEventById: (eventId: string) => (eventId === '$target' ? live : undefined),
    };

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [live],
      mapEvent: createPreferLiveEventMapper(room as never, mapRawEvent),
      loadLatest: async () => ({
        events: [makeRawMessage('$target', 'v1', { ts: 100, replacement: edit })],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('hydrate');
    expect(snapshot.events).toEqual([live]);
    expect(live.replacingEvent()?.getId()).toBe('$edit-v2');
  });

  it('skips latest room cache hydration when the loaded timeline is already newer', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 300 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) => makeEvent(rawEvent.event_id ?? '$missing'),
      loadLatest: async () => ({
        events: [{ event_id: '$cached-old', origin_server_ts: 200 }],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('already-loaded');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.loadedRoomCount).toBe(1);
  });

  it('hydrates only cached room events that are not already loaded', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 100 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        events: [
          { event_id: '$loaded', origin_server_ts: 100 },
          { event_id: '$cached-new', origin_server_ts: 200 },
        ],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('hydrate');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$cached-new']);
    expect(snapshot.cachedPage.events).toHaveLength(2);
    expect(snapshot.loadedRoomCount).toBe(1);
  });

  it('does not hydrate cached local echo room events', async () => {
    const loadedEvent = makeEvent('$loaded', { ts: 100 });

    const snapshot = await loadLatestRoomCacheHydrationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      limit: 32,
      loadedEvents: [loadedEvent] as never,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadLatest: async () => ({
        events: [
          { event_id: '$loaded', origin_server_ts: 100 },
          { event_id: '~!room:example.org:txn-1', origin_server_ts: 200 },
        ],
        hasMoreBefore: false,
      }),
    });

    expect(snapshot.status).toBe('empty-after-filter');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.cachedPage.events).toHaveLength(2);
    expect(snapshot.loadedRoomCount).toBe(1);
  });
});

describe('eventRepository room cached-back state snapshots', () => {
  it('loads cached room back state from the earliest loaded room event anchor', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });
    let requestedAnchor: unknown;

    const snapshot = await loadRoomCachedBackStateSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      loadBefore: async (_sessionId, _roomId, anchor, limit) => {
        requestedAnchor = anchor;
        expect(limit).toBe(1);
        return {
          events: [{ event_id: '$cached-before', origin_server_ts: 200 }],
          hasMoreBefore: false,
        };
      },
      loadPaginationToken: async () => null,
    });

    expect(requestedAnchor).toEqual({ eventId: '$loaded', ts: 300 });
    expect(snapshot.hasCachedBack).toBe(true);
    expect(snapshot.cachedBeforeToken).toBeNull();
  });
});

describe('eventRepository room cached pagination snapshots', () => {
  it('does not query cached room events when cache metadata proves the room start', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });
    let beforeQueried = false;

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      limit: 50,
      mapEvent: (rawEvent) => makeEvent(rawEvent.event_id ?? '$missing'),
      loadPaginationToken: async () => null,
      loadBefore: async () => {
        beforeQueried = true;
        return { events: [], hasMoreBefore: false };
      },
    });

    expect(beforeQueried).toBe(false);
    expect(snapshot.status).toBe('start-known');
    expect(snapshot.events).toEqual([]);
    expect(snapshot.hasMoreCachedBack).toBe(false);
  });

  it('loads cached room pagination events in timeline-prepend order', async () => {
    const earliestLoadedEvent = makeEvent('$loaded', { ts: 300 });

    const snapshot = await loadRoomCachedPaginationSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      earliestLoadedEvent: earliestLoadedEvent as never,
      limit: 50,
      mapEvent: (rawEvent) =>
        makeEvent(rawEvent.event_id ?? '$missing', {
          ts: rawEvent.origin_server_ts,
        }),
      loadPaginationToken: async () => undefined,
      loadBefore: async (_sessionId, _roomId, anchor, limit) => {
        expect(anchor).toEqual({ eventId: '$loaded', ts: 300 });
        expect(limit).toBe(50);
        return {
          events: [
            { event_id: '$older', origin_server_ts: 100 },
            { event_id: '$newer', origin_server_ts: 200 },
          ],
          hasMoreBefore: true,
          beforeToken: 'before-older',
        };
      },
    });

    expect(snapshot.status).toBe('cache-hit');
    expect(snapshot.events.map((event) => event.getId())).toEqual(['$newer', '$older']);
    expect(snapshot.beforeToken).toBe('before-older');
    expect(snapshot.hasMoreCachedBack).toBe(true);
  });
});

// CINNY-207 P1.4 (finding F5, decision D5): the write boundary excludes
// standalone same-sender replace records; hydration lazily cleans up any
// legacy records that still exist from before compaction landed.
describe('collectLegacyStandaloneReplaceIds (CINNY-207 P1.4)', () => {
  it('identifies replace records whose target already bundles an equal-or-newer edit', () => {
    const events = [
      {
        event_id: '$target',
        origin_server_ts: 100,
        sender: '@alice:example.org',
        content: {},
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              event_id: '$edit-2',
              origin_server_ts: 300,
              sender: '@alice:example.org',
            },
          },
        },
      },
      {
        event_id: '$edit-1',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
      {
        event_id: '$edit-2',
        origin_server_ts: 300,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
    ];

    expect(collectLegacyStandaloneReplaceIds(events)).toEqual(['$edit-1', '$edit-2']);
  });

  it('keeps standalone replaces newer than the target bundled edit (no data-loss window)', () => {
    const events = [
      {
        event_id: '$target',
        origin_server_ts: 100,
        sender: '@alice:example.org',
        content: {},
        unsigned: {
          'm.relations': {
            [RelationType.Replace]: {
              event_id: '$edit-1',
              origin_server_ts: 200,
              sender: '@alice:example.org',
            },
          },
        },
      },
      {
        event_id: '$edit-1',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
      {
        // Newer than the bundled edit: deleting it would lose the newest
        // content from cache until a later re-persist.
        event_id: '$edit-2',
        origin_server_ts: 300,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
    ];

    expect(collectLegacyStandaloneReplaceIds(events)).toEqual(['$edit-1']);
  });

  it('keeps all standalone replaces when the target has no bundled edit', () => {
    const events = [
      { event_id: '$target', origin_server_ts: 100, sender: '@alice:example.org', content: {} },
      {
        event_id: '$edit-1',
        origin_server_ts: 200,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
    ];

    expect(collectLegacyStandaloneReplaceIds(events)).toEqual([]);
  });

  // Round-2 review fix: the bundle only proves supersession if hydration
  // would actually apply it — same sender as the standalone, nonempty id.
  it('ignores cross-sender or id-less bundled edits as freshness proof', () => {
    const standalone = {
      event_id: '$edit-1',
      origin_server_ts: 200,
      sender: '@alice:example.org',
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
      },
    };
    const crossSenderBundleTarget = {
      event_id: '$target',
      origin_server_ts: 100,
      sender: '@alice:example.org',
      content: {},
      unsigned: {
        'm.relations': {
          [RelationType.Replace]: {
            event_id: '$edit-x',
            origin_server_ts: 900,
            sender: '@mallory:example.org',
          },
        },
      },
    };
    expect(collectLegacyStandaloneReplaceIds([crossSenderBundleTarget, standalone])).toEqual([]);

    const idlessBundleTarget = {
      event_id: '$target',
      origin_server_ts: 100,
      sender: '@alice:example.org',
      content: {},
      unsigned: {
        'm.relations': {
          [RelationType.Replace]: { origin_server_ts: 900, sender: '@alice:example.org' },
        },
      },
    };
    expect(collectLegacyStandaloneReplaceIds([idlessBundleTarget, standalone])).toEqual([]);
  });

  it('does not flag cross-sender replaces or replaces whose target is missing', () => {
    const events = [
      { event_id: '$target', origin_server_ts: 100, sender: '@alice:example.org', content: {} },
      {
        event_id: '$cross-sender',
        origin_server_ts: 200,
        sender: '@mallory:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
        },
      },
      {
        event_id: '$orphan-edit',
        origin_server_ts: 300,
        sender: '@alice:example.org',
        content: {
          'm.relates_to': { rel_type: RelationType.Replace, event_id: '$missing' },
        },
      },
    ];

    expect(collectLegacyStandaloneReplaceIds(events)).toEqual([]);
  });
});

describe('loadCachedThreadSnapshot lazy cleanup (CINNY-207 P1.4)', () => {
  it('deletes legacy standalone same-sender replace records whose target is in the batch', async () => {
    const deleteEvents = vi.fn(async () => undefined);
    const rootEvent = {
      event_id: '$root',
      origin_server_ts: 100,
      sender: '@alice:example.org',
      content: {},
    };
    const targetEvent = {
      event_id: '$target',
      origin_server_ts: 200,
      sender: '@alice:example.org',
      content: {},
      unsigned: {
        'm.relations': {
          [RelationType.Replace]: {
            event_id: '$edit-2',
            origin_server_ts: 220,
            sender: '@alice:example.org',
          },
        },
      },
    };
    const legacyEdit1 = {
      event_id: '$edit-1',
      origin_server_ts: 210,
      sender: '@alice:example.org',
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
      },
    };
    const legacyEdit2 = {
      event_id: '$edit-2',
      origin_server_ts: 220,
      sender: '@alice:example.org',
      content: {
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$target' },
      },
    };

    await loadCachedThreadSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 50,
      maxPages: 1,
      loadLatest: async () => ({
        rootEvent,
        events: [targetEvent, legacyEdit1, legacyEdit2],
        hasMoreBefore: false,
        beforeToken: null,
      }),
      deleteEvents,
    });

    expect(deleteEvents).toHaveBeenCalledTimes(1);
    expect(deleteEvents).toHaveBeenCalledWith('session', '!room:example.org', '$root', [
      '$edit-1',
      '$edit-2',
    ]);
  });

  it('does not delete anything when no legacy standalone replaces are present', async () => {
    const deleteEvents = vi.fn(async () => undefined);

    await loadCachedThreadSnapshot({
      sessionId: 'session',
      roomId: '!room:example.org',
      threadId: '$root',
      limit: 50,
      maxPages: 1,
      loadLatest: async () => ({
        rootEvent: { event_id: '$root', origin_server_ts: 100, sender: '@a', content: {} },
        events: [
          {
            event_id: '$reply',
            origin_server_ts: 200,
            sender: '@a',
            content: { body: 'hi' },
          },
        ],
        hasMoreBefore: false,
        beforeToken: null,
      }),
      deleteEvents,
    });

    expect(deleteEvents).not.toHaveBeenCalled();
  });
});

// CINNY-207 P2.3: the cache-write health gate moved OUT of the
// eventRepository seam and INTO the cacheStore save entry points
// (single choke point). The seam now unconditionally delegates to the
// injected `save`; per-save gating is exercised at the store level
// (see cacheStore/__tests__/cacheHealthGate.test.ts) and cacheHealth
// classification is exercised in cacheHealth.test.ts.
describe('persist entry points always delegate to the injected save (CINNY-207 P2.3)', () => {
  beforeEach(() => {
    resetCacheHealthForTesting();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  it('calls the injected room save even after a prior save rejected', async () => {
    const flakySave = vi.fn().mockRejectedValue(new Error('transient'));
    const room = makeRoom({ liveEvents: [] });

    persistRoomEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [],
      save: flakySave,
    });
    // First call landed; wait for microtasks to settle the (ignored)
    // rejection — the seam does not catch it.
    await Promise.resolve();

    persistRoomEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      events: [],
      save: flakySave,
    });
    expect(flakySave).toHaveBeenCalledTimes(2);
  });

  it('always calls the injected thread save (no seam-level gating)', () => {
    const threadSave = vi.fn().mockResolvedValue(undefined);
    const room = makeRoom({ liveEvents: [] });

    persistThreadEventCacheSnapshot({
      sessionId: 'session',
      room: room as never,
      threadId: '$root',
      events: [],
      save: threadSave,
    });
    // Meta-only save (no replies) still triggers a delegated save call —
    // the store is responsible for its own idle-check / gating semantics.
    expect(threadSave).toHaveBeenCalledTimes(1);
  });
});
