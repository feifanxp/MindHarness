import 'fake-indexeddb/auto';
import { MatrixEvent, type IEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveAttachmentOwner } from '../../__tests__/attachmentFixtures';
import {
  createPreferLiveEventMapper,
  persistThreadEventCacheSnapshot,
} from '../../eventRepository';
import {
  deleteCacheStoreDb,
  loadCachedAttachment,
  putCachedAttachment,
  loadLatestCachedRoomEvents,
  loadLatestCachedThreadEvents,
  loadCachedRoomPaginationToken,
  openCacheStore,
  readLedgerSnapshot,
  resetCacheStoreForTesting,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from '..';

const SESSION_ID = 'revision-merge-session';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root';
const SENDER = '@alice:example.org';

const message = (eventId: string, body: string, ts = 100): Partial<IEvent> => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body },
});

const edit = (eventId: string, targetId: string, body: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.message',
  content: {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  },
});

const redaction = (eventId: string, targetId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.redaction',
  redacts: targetId,
  content: {},
});

const withRevision = (
  eventId: string,
  editId: string,
  editTs: number,
  threadCount: number
): Partial<IEvent> => ({
  ...message(eventId, 'original'),
  unsigned: {
    'm.relations': {
      'm.replace': edit(editId, eventId, editId, editTs),
      'm.thread': { count: threadCount },
    },
  },
});

const withThreadBundle = (
  eventId: string,
  count: number,
  latestEventId: string,
  latestEventTs: number
): Partial<IEvent> => ({
  ...message(eventId, 'original'),
  unsigned: {
    'm.relations': {
      'm.thread': {
        count,
        latest_event: message(latestEventId, latestEventId, latestEventTs),
      },
    },
  },
});

const withAnnotationBundle = (eventId: string, count: number): Partial<IEvent> => ({
  ...message(eventId, 'original'),
  unsigned: {
    'm.relations': {
      'm.annotation': {
        chunk: [
          {
            type: 'm.reaction',
            key: '👍',
            count,
          },
        ],
      },
    },
  },
});

const redacted = (eventId: string): Partial<IEvent> => ({
  ...message(eventId, 'removed'),
  content: {},
  unsigned: {
    'm.relations': {
      'm.replace': edit('$redacted-edit', eventId, 'edited secret', 250),
    },
    redacted_because: {
      event_id: `$redaction-${eventId}`,
      origin_server_ts: 300,
      sender: SENDER,
      type: 'm.room.redaction',
      redacts: eventId,
      content: {},
    },
  },
});

const expectRedacted = (event: Partial<IEvent> | undefined): void => {
  expect(event?.content).toEqual({});
  expect(event?.unsigned?.redacted_because).toBeDefined();
  expect(
    (event?.unsigned?.['m.relations'] as Record<string, unknown> | undefined)?.['m.replace']
  ).toBeUndefined();
  expect(JSON.stringify(event)).not.toContain('removed');
  expect(JSON.stringify(event)).not.toContain('edited secret');
};

const expectNewestEditWithMonotonicAggregations = (event: Partial<IEvent> | undefined): void => {
  const relations = event?.unsigned?.['m.relations'] as
    | Record<string, Partial<IEvent> & { count?: number }>
    | undefined;
  expect(relations?.['m.replace']?.event_id).toBe('$edit-v3');
  expect(relations?.['m.thread']?.count).toBe(7);
};

describe('cache storage same-ID revision merge', () => {
  beforeEach(() => resetCacheStoreForTesting());
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
    resetCacheStoreForTesting();
  });

  it.each(['room', 'thread'] as const)(
    'revokes attachment writes when %s persistence observes a deletion',
    async (scope) => {
      const owner = { roomId: ROOM_ID, eventId: '$body', revisionTs: 100, essential: true };
      const payload = {
        mxcUri: 'mxc://example.org/body',
        mimeType: 'application/json',
        bytes: new TextEncoder().encode('old body').buffer,
      };
      await saveAttachmentOwner(SESSION_ID, ROOM_ID, '$body', 100, [
        { mxcUri: payload.mxcUri, essential: true },
      ]);
      await putCachedAttachment(SESSION_ID, payload, owner);
      expect(await loadCachedAttachment(SESSION_ID, payload.mxcUri)).toBeDefined();

      // Live sync carries a redaction; reconciliation can carry only its pruned target.
      if (scope === 'room') {
        await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [redaction('$delete', '$body', 300)]);
      } else {
        await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [redacted('$body')]);
      }
      expect(await loadCachedAttachment(SESSION_ID, payload.mxcUri)).toBeUndefined();

      // A late consumer cannot register its old revision or restore its downloaded bytes.
      expect(
        await saveAttachmentOwner(SESSION_ID, ROOM_ID, '$body', 100, [
          { mxcUri: payload.mxcUri, essential: true },
        ])
      ).toBe(true);
      await putCachedAttachment(SESSION_ID, payload, owner);
      expect(await loadCachedAttachment(SESSION_ID, payload.mxcUri)).toBeUndefined();
    }
  );

  it('keeps shared attachment bytes until every message owner is deleted', async () => {
    const payload = {
      mxcUri: 'mxc://example.org/shared',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('shared body').buffer,
    };
    const owners = [
      { roomId: ROOM_ID, eventId: '$one' },
      { roomId: ROOM_ID, eventId: '$two' },
      { roomId: '!other:example.org', eventId: '$three' },
    ];
    for (const owner of owners) {
      await saveAttachmentOwner(SESSION_ID, owner.roomId, owner.eventId, 100, [
        { mxcUri: payload.mxcUri, essential: true },
      ]);
      await putCachedAttachment(SESSION_ID, payload, {
        ...owner,
        revisionTs: 100,
        essential: true,
      });
    }
    for (const [index, owner] of owners.entries()) {
      const deletion = redaction(`$delete-${index}`, owner.eventId, 300);
      await saveRoomEventsToCache(SESSION_ID, owner.roomId, [deletion]);
      // Re-observing an already marked deletion must preserve the same surviving owners.
      await saveRoomEventsToCache(SESSION_ID, owner.roomId, [deletion]);
      const saved = await loadCachedAttachment(SESSION_ID, payload.mxcUri);
      if (index < owners.length - 1) {
        expect(new TextDecoder().decode(saved?.bytes)).toBe('shared body');
      } else expect(saved).toBeUndefined();
    }
  });

  it('does not overwrite a redacted room event with stale plaintext', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [redacted('$room-event')]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [message('$room-event', 'secret')]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    expectRedacted(page.events[0]);
  });

  it('scrubs a redacted edit from every room scope and the thread root ledger-safely', async () => {
    const secretEdit = edit('$secret-edit', '$message', 'edited secret', 300);
    const target = {
      ...message('$message', 'original', 100),
      unsigned: {
        'm.relations': {
          'm.annotation': { chunk: [{ type: 'm.reaction', key: '👍', count: 1 }] },
          'm.replace': secretEdit,
          'm.thread': {
            count: 1,
            latest_event: {
              ...message('$reply', 'reply', 200),
              unsigned: { 'm.relations': { 'm.replace': secretEdit } },
            },
          },
        },
      },
    } satisfies Partial<IEvent>;
    const root = {
      ...message(THREAD_ID, 'root', 50),
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
            latest_event: {
              ...message('$reply', 'reply', 200),
              unsigned: { 'm.relations': { 'm.replace': secretEdit } },
            },
          },
        },
      },
    } satisfies Partial<IEvent>;

    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [target, secretEdit]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [target, secretEdit], root);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      {
        event_id: '$redaction-secret-edit',
        origin_server_ts: 400,
        sender: SENDER,
        type: 'm.room.redaction',
        redacts: '$secret-edit',
        content: {},
      },
    ]);
    // A later stale page must not reintroduce either the bundled plaintext
    // or the standalone edit after the redaction batch is gone.
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [target, secretEdit]);
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [target, secretEdit],
      root,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'authoritative'
    );

    const roomPage = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 20);
    const threadPage = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 20);
    const storedEvents = [...roomPage.events, ...threadPage.events];
    expect(storedEvents.some((event) => event.event_id === '$secret-edit')).toBe(false);
    expect(JSON.stringify({ roomPage, threadPage })).not.toContain('edited secret');
    expect(
      (
        roomPage.events.find((event) => event.event_id === '$message')?.unsigned?.[
          'm.relations'
        ] as Record<string, unknown>
      )?.['m.annotation']
    ).toEqual({ chunk: [{ type: 'm.reaction', key: '👍', count: 1 }] });
    expect(
      (
        threadPage.rootEvent?.unsigned?.['m.relations']?.['m.thread'] as
          | { count?: number; latest_event?: Partial<IEvent> }
          | undefined
      )?.count
    ).toBe(1);

    const db = await openCacheStore(SESSION_ID);
    expect(db).toBeDefined();
    const ledger = (await readLedgerSnapshot(db!)).find((row) => row.roomId === ROOM_ID);
    expect(ledger).toMatchObject({
      eventCount: storedEvents.length,
      approxBytes: storedEvents.reduce((sum, event) => sum + JSON.stringify(event).length, 0),
    });
  });

  it('purges direct redaction targets across scopes and rejects stale same-id replays', async () => {
    const target = message('$message-target', 'message secret', 100);
    const reaction = {
      event_id: '$reaction-target',
      origin_server_ts: 110,
      sender: SENDER,
      type: 'm.reaction',
      content: {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: '$message-target',
          key: 'reaction secret',
        },
      },
    } satisfies Partial<IEvent>;
    const root = message(THREAD_ID, 'root secret', 50);

    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [target, reaction]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [target, reaction], root);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      redaction('$redact-message', '$message-target', 300),
      redaction('$redact-reaction', '$reaction-target', 301),
      redaction('$redact-root', THREAD_ID, 302),
    ]);

    const redactedRoomPage = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 20);
    const redactedThreadPage = await loadLatestCachedThreadEvents(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      20
    );
    expect(redactedRoomPage.events.map((event) => event.event_id)).not.toEqual(
      expect.arrayContaining(['$message-target', '$reaction-target'])
    );
    expect(redactedThreadPage.events.map((event) => event.event_id)).not.toEqual(
      expect.arrayContaining(['$message-target', '$reaction-target'])
    );
    expect(redactedThreadPage.rootEvent).toBeUndefined();

    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [target, reaction, message('$room-valid', 'valid room event', 400)],
      'room-after-redaction'
    );
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [target, reaction, message('$thread-valid', 'valid thread event', 400)],
      root,
      'thread-after-redaction'
    );

    const roomPage = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 20);
    const threadPage = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 20);
    const serializedCache = JSON.stringify({ roomPage, threadPage });
    expect(serializedCache).not.toContain('message secret');
    expect(serializedCache).not.toContain('reaction secret');
    expect(serializedCache).not.toContain('root secret');
    expect(threadPage.rootEvent).toBeUndefined();
    expect(await loadCachedRoomPaginationToken(SESSION_ID, ROOM_ID, '$room-valid')).toBe(
      'room-after-redaction'
    );
    // Thread token is asserted through the production `beforeToken` path:
    // when `$thread-valid` is the earliest surviving event, its stored
    // token is what the paginator will see on the next backward read.
    expect(threadPage.events[0]?.event_id).toBe('$thread-valid');
    expect(threadPage.beforeToken).toBe('thread-after-redaction');

    const storedEvents = [...roomPage.events, ...threadPage.events];
    const db = await openCacheStore(SESSION_ID);
    const ledger = (await readLedgerSnapshot(db!)).find((row) => row.roomId === ROOM_ID);
    expect(ledger).toMatchObject({
      eventCount: storedEvents.length,
      approxBytes: storedEvents.reduce((sum, event) => sum + JSON.stringify(event).length, 0),
    });
  });

  it('anchors pagination tokens to the first event that survives redaction filtering', async () => {
    const staleEdit = edit('$redacted-edit', '$target', 'stale secret', 100);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      {
        event_id: '$redaction-edit',
        origin_server_ts: 90,
        sender: SENDER,
        type: 'm.room.redaction',
        redacts: '$redacted-edit',
        content: {},
      },
    ]);

    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [staleEdit, message('$room-valid', 'valid', 200)],
      'room-token'
    );
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [staleEdit, message('$thread-valid', 'valid', 200)],
      undefined,
      'thread-token'
    );

    expect(await loadCachedRoomPaginationToken(SESSION_ID, ROOM_ID, '$room-valid')).toBe(
      'room-token'
    );
    // Same pattern as the previous scenario: `$thread-valid` is the
    // earliest event to survive redaction filtering, so the paginator's
    // beforeToken must be anchored to its stored token.
    const anchoredThreadPage = await loadLatestCachedThreadEvents(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      20
    );
    expect(anchoredThreadPage.events[0]?.event_id).toBe('$thread-valid');
    expect(anchoredThreadPage.beforeToken).toBe('thread-token');
    expect(JSON.stringify(await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 20))).not.toContain(
      'stale secret'
    );
    expect(JSON.stringify(anchoredThreadPage)).not.toContain('stale secret');
  });

  it('keeps the newest room edit while independently advancing partial aggregations', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withRevision('$room-event', '$edit-v3', 300, 3),
    ]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withRevision('$room-event', '$edit-v2', 200, 7),
    ]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    expectNewestEditWithMonotonicAggregations(page.events[0]);
  });

  it('keeps existing thread aggregations when a newer edit observation omits them', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withRevision('$room-event', '$edit-v2', 200, 7),
    ]);
    const newerEditWithoutAggregations = {
      ...message('$room-event', 'original'),
      unsigned: {
        'm.relations': {
          'm.replace': edit('$edit-v3', '$room-event', 'v3', 300),
        },
      },
    };
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [newerEditWithoutAggregations]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    const relations = page.events[0]?.unsigned?.['m.relations'] as
      | Record<string, { event_id?: string; count?: number }>
      | undefined;
    expect(relations?.['m.replace']?.event_id).toBe('$edit-v3');
    expect(relations?.['m.thread']?.count).toBe(7);
  });

  it('accepts a lower thread count from an authoritative snapshot', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withThreadBundle('$thread-root-event', 7, '$latest-old', 100),
    ]);
    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [withThreadBundle('$thread-root-event', 3, '$latest-new', 200)],
      undefined,
      'authoritative'
    );

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    const thread = (
      page.events[0]?.unsigned?.['m.relations'] as
        | Record<string, { count?: number; latest_event?: Partial<IEvent> }>
        | undefined
    )?.['m.thread'];
    expect(thread?.count).toBe(3);
    expect(thread?.latest_event?.event_id).toBe('$latest-new');
  });

  it('advances a partial thread aggregation and ignores a later stale downgrade', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withThreadBundle('$thread-root-event', 2, '$latest-old', 100),
    ]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withThreadBundle('$thread-root-event', 5, '$latest-new', 200),
    ]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      withThreadBundle('$thread-root-event', 2, '$latest-old', 100),
    ]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    const thread = (
      page.events[0]?.unsigned?.['m.relations'] as
        | Record<string, { count?: number; latest_event?: Partial<IEvent> }>
        | undefined
    )?.['m.thread'];
    expect(thread?.count).toBe(5);
    expect(thread?.latest_event?.event_id).toBe('$latest-new');
  });

  it('advances partial annotation counts and ignores a later stale bucket', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [withAnnotationBundle('$annotated', 2)]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [withAnnotationBundle('$annotated', 5)]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [withAnnotationBundle('$annotated', 2)]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    const annotation = (
      page.events[0]?.unsigned?.['m.relations'] as
        | Record<string, { chunk?: Array<{ count?: number; event_id?: string }> }>
        | undefined
    )?.['m.annotation'];
    expect(annotation?.chunk).toEqual([expect.objectContaining({ count: 5 })]);
  });

  it('does not let a partial annotation observation replace an existing bucket', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [withAnnotationBundle('$annotated', 5)]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [withAnnotationBundle('$annotated', 2)]);

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    const annotation = (
      page.events[0]?.unsigned?.['m.relations'] as
        | Record<string, { chunk?: Array<{ count?: number; event_id?: string }> }>
        | undefined
    )?.['m.annotation'];
    expect(annotation?.chunk).toEqual([expect.objectContaining({ count: 5 })]);
  });

  it('removes unrelated bundles when an authoritative snapshot omits them', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      {
        ...message('$referenced', 'original'),
        unsigned: { 'm.relations': { 'm.reference': { chunk: [{ event_id: '$ref' }] } } },
      },
    ]);
    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [message('$referenced', 'authoritative')],
      undefined,
      'authoritative'
    );

    const page = await loadLatestCachedRoomEvents(SESSION_ID, ROOM_ID, 10);
    expect(page.events[0]?.unsigned?.['m.relations']).toBeUndefined();
  });

  it('does not overwrite a redacted thread reply with stale plaintext', async () => {
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [redacted('$reply')]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [message('$reply', 'secret')]);

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectRedacted(page.events[0]);
  });

  it('prunes a stale authoritative redaction before it reaches IndexedDB', async () => {
    const redaction = {
      event_id: '$redaction-reply',
      origin_server_ts: 300,
      sender: SENDER,
      type: 'm.room.redaction',
      redacts: '$reply',
      content: {},
    } satisfies Partial<IEvent>;
    const staleServerReply = {
      ...message('$reply', 'secret from stale /relations'),
      unsigned: {
        redacted_because: redaction,
        'm.relations': {
          'm.annotation': { chunk: [{ type: 'm.reaction', key: '👍', count: 2 }] },
          'm.replace': edit('$stale-edit', '$reply', 'edited secret', 250),
        },
      },
    } satisfies Partial<IEvent>;
    const room = {
      roomId: ROOM_ID,
      findEventById: () => undefined,
    } as unknown as Room;
    const mapped = createPreferLiveEventMapper(
      room,
      (rawEvent) => new MatrixEvent(rawEvent as IEvent)
    )(staleServerReply);

    const snapshot = persistThreadEventCacheSnapshot({
      sessionId: SESSION_ID,
      room,
      threadId: THREAD_ID,
      events: [mapped],
      authoritativeRawEvents: [staleServerReply],
      relationSnapshotMode: 'authoritative',
    });
    await snapshot.write;
    resetCacheStoreForTesting();

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectRedacted(page.events[0]);
    expect(page.events[0]?.unsigned?.['m.relations']).toMatchObject({
      'm.annotation': { chunk: [{ type: 'm.reaction', key: '👍', count: 2 }] },
    });
    expect(JSON.stringify(page.events[0])).not.toContain('secret from stale /relations');
  });

  it('keeps the newest thread-reply edit while advancing partial aggregations', async () => {
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [
      withRevision('$reply', '$edit-v3', 300, 3),
    ]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [
      withRevision('$reply', '$edit-v2', 200, 7),
    ]);

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectNewestEditWithMonotonicAggregations(page.events[0]);
  });

  it('does not overwrite a redacted thread root with stale plaintext', async () => {
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], redacted(THREAD_ID));
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], message(THREAD_ID, 'secret'));

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectRedacted(page.rootEvent);
  });

  it('keeps a redacted thread root while accepting newer thread aggregations', async () => {
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], redacted(THREAD_ID));
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [],
      withRevision(THREAD_ID, '$stale-secret-edit', 400, 7)
    );

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectRedacted(page.rootEvent);
    const relations = page.rootEvent?.unsigned?.['m.relations'] as
      | Record<string, { count?: number }>
      | undefined;
    expect(relations?.['m.thread']?.count).toBe(7);
    expect(JSON.stringify(page.rootEvent)).not.toContain('$stale-secret-edit');
  });

  it('applies authoritative thread-root decreases and participation changes', async () => {
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], {
      ...message(THREAD_ID, 'root'),
      unsigned: {
        'm.relations': {
          'm.thread': { count: 7, current_user_participated: true },
        },
      },
    });
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [],
      {
        ...message(THREAD_ID, 'root'),
        unsigned: {
          'm.relations': {
            'm.thread': { count: 3, current_user_participated: false },
          },
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'authoritative'
    );

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    const thread = (
      page.rootEvent?.unsigned?.['m.relations'] as
        | Record<string, { count?: number; current_user_participated?: boolean }>
        | undefined
    )?.['m.thread'];
    expect(thread).toEqual({ count: 3, current_user_participated: false });
  });

  it('preserves cached thread aggregations when a newer tombstone has none', async () => {
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [],
      withRevision(THREAD_ID, '$edit-before-redaction', 200, 3)
    );
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, THREAD_ID, [], redacted(THREAD_ID));

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectRedacted(page.rootEvent);
    const relations = page.rootEvent?.unsigned?.['m.relations'] as
      | Record<string, { count?: number }>
      | undefined;
    expect(relations?.['m.thread']?.count).toBe(3);
  });

  it('keeps the newest thread-root edit while advancing partial aggregations', async () => {
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [],
      withRevision(THREAD_ID, '$edit-v3', 300, 3)
    );
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [],
      withRevision(THREAD_ID, '$edit-v2', 200, 7)
    );

    const page = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, THREAD_ID, 10);
    expectNewestEditWithMonotonicAggregations(page.rootEvent);
  });
});
