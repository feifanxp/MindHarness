import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Direction, MatrixEvent } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { saveAttachmentOwner } from '../../threads/__tests__/attachmentFixtures';
import { createBackfillScheduler } from '../backfillScheduler';
import { enqueueRoomDeepHistoryJob } from '../deepHistoryJob';
import { StateEvent } from '../../../../types/matrix/room';
import {
  loadCachedRoomEvent,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
} from '../../threads/cacheStore';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import { readRoomOfflineProgress } from '../../threads/cacheStore/cacheStoreMeta';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
} from '../../threads/threadOpenSeedCache';

const SESSION_ID = 'session-p43';

// CINNY-207 P7.2 audit finding #3: deep-history now maps each raw
// chunk event through `createPreferLiveEventMapper` before persisting.
// `findEventById` is required on the room stub (returns null → mapper
// stays on the "clone the raw event" branch for these unit fixtures,
// which never simulate a live SDK instance).
const makeRoom = (
  roomId: string,
  createSender: string,
  encrypted = false,
  liveBackToken: string | undefined = undefined
): Room =>
  ({
    roomId,
    findEventById: () => null,
    getThread: () => null,
    hasEncryptionStateEvent: () => encrypted,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return { getSender: () => createSender } as unknown as ReturnType<
            ReturnType<Room['getLiveTimeline']>['getState']
          >['getStateEvents'];
        },
      }),
      getPaginationToken: (dir: Direction) => (dir === Direction.Backward ? liveBackToken : null),
    }),
    getLastActiveTimestamp: () => 0,
  } as unknown as Room);

type MockClient = MatrixClient & {
  __rooms: Map<string, Room>;
  __calls: Array<{ roomId: string; fromToken: string | null; limit: number | undefined }>;
};

const rawEvent = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:mindroom.chat',
  room_id: '!room:mindroom.chat',
  content: { body: id },
});

const rawThreadReply = (id: string, ts: number, threadRootId: string): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  sender: '@alice:mindroom.chat',
  room_id: '!room:mindroom.chat',
  content: {
    body: id,
    'm.relates_to': { event_id: threadRootId, rel_type: 'm.thread' },
  },
});

const createMockClient = (
  responder: (call: number) => { end?: string; chunk: Partial<IEvent>[] }
): MockClient => {
  const rooms = new Map<string, Room>();
  const calls: MockClient['__calls'] = [];
  const client = {
    getDomain: () => 'mindroom.chat',
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    // CINNY-207 P7.2 audit finding #3: preferLive mapper is resolved via
    // this hook inside `persistRoomChunkWithPreferLive`.
    getEventMapper: () => (raw: Partial<IEvent>) => new MatrixEvent(raw),
    createMessagesRequest: vi
      .fn()
      .mockImplementation(
        async (roomId: string, fromToken: string | null, limit: number, _dir: Direction) => {
          calls.push({ roomId, fromToken, limit });
          return responder(calls.length - 1);
        }
      ),
    __rooms: rooms,
    __calls: calls,
  } as unknown as MockClient;
  return client;
};

describe('enqueueRoomDeepHistoryJob (CINNY-207 P4.3)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    resetCacheProbe();
    clearThreadOpenSeedSnapshotsForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    resetCacheProbe();
    clearThreadOpenSeedSnapshotsForTests();
  });

  it('drives createMessagesRequest backward until the target is reached and persists each chunk', async () => {
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [rawEvent('$a', 1), rawEvent('$b', 2)] };
      if (call === 1) return { end: 'tok-2', chunk: [rawEvent('$c', 3)] };
      return { chunk: [] }; // end undefined → stop
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));

    const scheduler = createBackfillScheduler({ mx });
    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });
    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });

    // Target reached after chunk 2 (2 + 1 = 3), loop terminates.
    expect(mx.__calls.length).toBeGreaterThanOrEqual(2);
    for (const id of ['$a', '$b', '$c']) {
      // eslint-disable-next-line no-await-in-loop
      const row = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', id);
      expect(row?.event_id).toBe(id);
    }
    expect(getCacheProbeSnapshot().schedulerCompleted).toBe(2);
  });

  it('persists thread replies from swept chunks into their thread cache scopes (2026-07-06 eager-cache fix)', async () => {
    // The cold-start regression: the deep-history sweep downloads all
    // room history — thread replies included — but used to persist ONLY
    // the room scope (serializeRoomCacheEvents filters thread activity),
    // throwing the thread content away. Opening a thread then re-
    // downloaded everything the sweep had already fetched. The sweep
    // must teach the thread caches from the same chunks.
    const root = rawEvent('$root', 10);
    const reply1 = rawThreadReply('$reply-1', 20, '$root');
    const reply2 = rawThreadReply('$reply-2', 30, '$root');
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'tok-1', chunk: [reply2, reply1, root] };
      return { chunk: [] };
    });
    const room = makeRoom('!room:mindroom.chat', '@alice:mindroom.chat');
    mx.__rooms.set('!room:mindroom.chat', room);

    const scheduler = createBackfillScheduler({ mx });
    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });

    // Thread scope holds the replies, with the tail claim recorded (the
    // sweep descends from the live tail, so every encountered thread's
    // newest replies are covered) and NO completeness over-claim.
    const threadPage = await loadLatestCachedThreadEvents(
      SESSION_ID,
      '!room:mindroom.chat',
      '$root',
      10
    );
    expect(threadPage.events.map((event) => event.event_id)).toEqual(['$reply-1', '$reply-2']);
    expect(threadPage.tailLoaded).toBe(true);
    expect(threadPage.snapshotComplete).toBe(false);
    expect(threadPage.relationSnapshotComplete).toBe(false);

    // Room scope keeps its existing shape: root persisted, thread-only
    // replies still filtered out of the room slice.
    const rootRow = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$root');
    expect(rootRow?.event_id).toBe('$root');
    const replyRow = await loadCachedRoomEvent(SESSION_ID, '!room:mindroom.chat', '$reply-1');
    expect(replyRow).toBeUndefined();

    // The in-memory seed store must NOT pin sweep events (a 10k-event
    // sweep would otherwise leak its whole mapped batch into memory).
    expect(getThreadOpenSeedSnapshot(room, '$root')).toHaveLength(0);
  });

  it('allows encrypted history through SDK mapping', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set(
      '!e2e:mindroom.chat',
      makeRoom('!e2e:mindroom.chat', '@alice:mindroom.chat', true)
    );
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!e2e:mindroom.chat',
    });

    expect(mx.__calls.length).toBe(1);
  });

  it('fetches a federated room admitted by the controller', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
    });

    expect(mx.__calls.length).toBe(1);
  });

  it('sweeps a federated focused room under all-rooms scope (PR #72 greptile: deep history skipped scope)', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
    });

    // Gate passes -> at least one backward /messages request fires.
    expect(mx.__calls.length).toBeGreaterThan(0);
  });

  it('sweeps a federated focused room under current-room-only scope (deep history always targets the focused room)', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    mx.__rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!fed:example.org',
    });

    expect(mx.__calls.length).toBeGreaterThan(0);
  });

  it('deduplicates concurrent deep-history requests (AC8)', async () => {
    // Slow-response mock so both enqueues land while the first job is
    // still in-flight.
    const rooms = new Map<string, Room>();
    rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));
    const mx = {
      getDomain: () => 'mindroom.chat',
      getRoom: (roomId: string) => rooms.get(roomId) ?? null,
      createMessagesRequest: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ chunk: [] }), 30);
          })
      ),
    } as unknown as MatrixClient;
    const scheduler = createBackfillScheduler({ mx });

    const first = enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });
    const second = enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });
    expect(second).toBe(first);
    expect(getCacheProbeSnapshot().schedulerDeduped).toBe(1);

    await first;
  });

  it('saves thread replies even when SDK room pagination already passed them', async () => {
    const mx = createMockClient(() => ({ chunk: [] }));
    const reply = rawThreadReply('$missed-reply', 20, '$root');
    vi.mocked(mx.createMessagesRequest).mockImplementation(async (_roomId, from) => ({
      chunk: from === null ? [reply as IEvent] : [],
    }));
    mx.__rooms.set(
      '!room:mindroom.chat',
      makeRoom('!room:mindroom.chat', '@alice:mindroom.chat', false, 'live-back-token')
    );
    const scheduler = createBackfillScheduler({ mx });

    await enqueueRoomDeepHistoryJob({
      mx,
      sessionId: SESSION_ID,
      scheduler,
      roomId: '!room:mindroom.chat',
    });

    const page = await loadLatestCachedThreadEvents(SESSION_ID, '!room:mindroom.chat', '$root', 10);
    expect(page.events.map((event) => event.event_id)).toEqual(['$missed-reply']);
    expect(mx.createMessagesRequest).toHaveBeenCalledWith(
      '!room:mindroom.chat',
      null,
      200,
      Direction.Backward
    );
  });

  it('resumes from the committed page after failure with a new scheduler', async () => {
    const mx = createMockClient((call) => {
      if (call === 0) return { end: 'older-1', chunk: [rawEvent('$saved', 1)] };
      if (call === 1) throw new Error('offline');
      return { chunk: [] };
    });
    mx.__rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));
    const args = { mx, sessionId: SESSION_ID, roomId: '!room:mindroom.chat' };
    await enqueueRoomDeepHistoryJob({ ...args, scheduler: createBackfillScheduler({ mx }) });
    await expect(
      enqueueRoomDeepHistoryJob({ ...args, scheduler: createBackfillScheduler({ mx }) })
    ).rejects.toThrow('offline');
    expect(await loadCachedRoomEvent(SESSION_ID, args.roomId, '$saved')).toBeDefined();
    resetCacheStoreForTesting();
    await enqueueRoomDeepHistoryJob({ ...args, scheduler: createBackfillScheduler({ mx }) });
    expect(mx.__calls.map((call) => call.fromToken)).toEqual([null, 'older-1', 'older-1']);
  });

  it('bounds pagination checkpoints while rejecting recent token cycles', async () => {
    const mx = createMockClient((call) => ({
      end: call < 20 ? 'token-' + (call + 1) : 'token-19',
      chunk: [rawEvent('$page-' + call, call + 1)],
    }));
    const roomId = '!room:mindroom.chat';
    mx.getEventMapper = () => (event) => new MatrixEvent(event);
    mx.__rooms.set(roomId, makeRoom(roomId, '@alice:mindroom.chat'));
    const args = { mx, sessionId: SESSION_ID, scheduler: createBackfillScheduler({ mx }), roomId };
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueRoomDeepHistoryJob(args);
    }
    const progress = await readRoomOfflineProgress(SESSION_ID, roomId);
    expect(progress.savedEvents).toBe(20);
    expect(progress.recentTokens!.length).toBeLessThanOrEqual(8);
    expect(progress.nextToken).toBe('token-20');
    await expect(enqueueRoomDeepHistoryJob(args)).rejects.toThrow(
      'History pagination did not advance'
    );
    expect((await readRoomOfflineProgress(SESSION_ID, roomId)).nextToken).toBe('token-20');
  });

  it('attributes an edit to a reply first encountered on a later history page', async () => {
    const edit = {
      ...rawEvent('$edit', 30),
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        'm.new_content': { msgtype: 'm.text', body: 'edited historical reply' },
      },
    };
    const mx = createMockClient((call) =>
      call === 0
        ? { chunk: [edit], end: 'older' }
        : { chunk: [rawThreadReply('$reply', 20, '$root')], end: 'oldest' }
    );
    mx.getEventMapper = () => (raw) => new MatrixEvent(raw);
    mx.__rooms.set('!room:mindroom.chat', makeRoom('!room:mindroom.chat', '@alice:mindroom.chat'));
    const args = {
      mx,
      sessionId: SESSION_ID,
      scheduler: createBackfillScheduler({ mx }),
      roomId: '!room:mindroom.chat',
    };
    await enqueueRoomDeepHistoryJob(args);
    await enqueueRoomDeepHistoryJob(args);
    const page = await loadLatestCachedThreadEvents(SESSION_ID, args.roomId, '$root', 20);
    expect(
      page.events.find((event) => event.event_id === '$reply')?.unsigned?.['m.relations']?.[
        'm.replace'
      ]
    ).toMatchObject({
      event_id: '$edit',
      content: { 'm.new_content': { body: 'edited historical reply' } },
    });
  });

  it('retracts a compacted edit before accepting the surviving original attachment', async () => {
    const original = {
      ...rawEvent('$original', 10),
      content: {
        msgtype: 'm.text',
        body: 'original',
        url: 'mxc://test/original',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
    };
    const edit = {
      ...rawEvent('$edit', 30),
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
        'm.new_content': { ...original.content, url: 'mxc://test/edited' },
      },
    };
    const redaction = {
      ...rawEvent('$redaction', 40),
      type: 'm.room.redaction',
      redacts: '$edit',
      content: { redacts: '$edit' },
    };
    const mx = createMockClient((call) =>
      call === 0 ? { chunk: [original, edit], end: 'older' } : { chunk: [redaction] }
    );
    mx.getEventMapper = () => (raw) => new MatrixEvent(raw);
    const room = makeRoom('!room:mindroom.chat', '@alice:mindroom.chat');
    mx.__rooms.set(room.roomId, room);
    const args = {
      mx,
      sessionId: SESSION_ID,
      scheduler: createBackfillScheduler({ mx }),
      roomId: room.roomId,
    };
    await enqueueRoomDeepHistoryJob(args);
    await saveAttachmentOwner(
      SESSION_ID,
      room.roomId,
      '$original',
      30,
      [{ mxcUri: 'mxc://test/edited', essential: true }],
      undefined,
      { revisionId: '$edit' }
    );
    await enqueueRoomDeepHistoryJob(args);
    expect(
      await saveAttachmentOwner(SESSION_ID, room.roomId, '$original', 10, [
        { mxcUri: 'mxc://test/original', essential: true },
      ])
    ).toBe(true);
    expect(
      await saveAttachmentOwner(
        SESSION_ID,
        room.roomId,
        '$original',
        30,
        [{ mxcUri: 'mxc://test/edited', essential: true }],
        undefined,
        { revisionId: '$edit' }
      )
    ).toBe(true);
    const cached = await loadCachedRoomEvent(SESSION_ID, room.roomId, '$original');
    expect(cached?.unsigned?.['m.relations']?.['m.replace']).toBeUndefined();
  });
});
