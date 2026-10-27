import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Direction, MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteCacheStoreDb, saveRoomEventsToCache } from './cacheStore';
import { useRoomCacheHydrationController } from './roomCacheHydrationController';
import { getInitialTimeline, getLinkedTimelines, type Timeline } from './timelinePagination';
import * as eventRepository from './eventRepository';

const SESSION_ID = 'room-hydration-session';
const ROOM_ID = '!room:example.org';
const USER_ID = '@alice:example.org';

const message = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  room_id: ROOM_ID,
  sender: USER_ID,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: id },
});

function Harness(props: Parameters<typeof useRoomCacheHydrationController>[0]) {
  useRoomCacheHydrationController(props);
  return null;
}

describe('room cache hydration with a restored SDK tail', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await deleteCacheStoreDb(SESSION_ID);
    vi.restoreAllMocks();
  });

  const openRoom = async (room: Room, mx: MatrixClient, afterRead?: () => void) => {
    const published: string[][] = [];
    let hydrated = false;
    if (afterRead) {
      const loadSnapshot = eventRepository.loadLatestRoomCacheHydrationSnapshot;
      vi.spyOn(eventRepository, 'loadLatestRoomCacheHydrationSnapshot').mockImplementationOnce(
        async (options) => {
          const snapshot = await loadSnapshot(options);
          afterRead();
          return snapshot;
        }
      );
    }
    const props: Parameters<typeof useRoomCacheHydrationController>[0] = {
      alive: () => true,
      buildInitialTimeline: () => getInitialTimeline(room, 200),
      mx,
      room,
      roomDebugTraceId: 'cached-room-open',
      roomIdRef: { current: room.roomId },
      scrollToBottomRef: { current: { count: 0, smooth: false } },
      sessionId: SESSION_ID,
      setAtBottom: () => undefined,
      setRoomInitialCacheHydratedKey: () => {
        hydrated = true;
      },
      setTimeline: (timeline) => {
        const next = timeline as Timeline;
        published.push(
          next.linkedTimelines.flatMap((part) => part.getEvents().map((e) => e.getId()!))
        );
      },
      threadId: undefined,
      threadIdRef: { current: undefined },
    };
    await act(async () => {
      renderer = create(<Harness {...props} />);
      await vi.waitFor(() => expect(hydrated).toBe(true));
    });
    return published;
  };

  it.each(['same', 'newer'])(
    'restores all cached roots together when the SDK tail is %s',
    async (tail) => {
      const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
      const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
      const roots = [message('$older', 100), message('$middle', 200), message('$latest', 300)];
      await saveRoomEventsToCache(SESSION_ID, ROOM_ID, roots, null);
      const latest = new MatrixEvent(roots[2]);
      await room.addLiveEvents([latest], { fromCache: true, addToState: false });
      if (tail === 'newer') {
        await room.addLiveEvents([new MatrixEvent(message('$live', 400))], { addToState: false });
      }
      room.getLiveTimeline().setPaginationToken('sdk-before', Direction.Backward);

      const published = await openRoom(room, mx);

      const expected =
        tail === 'same'
          ? ['$older', '$middle', '$latest']
          : ['$older', '$middle', '$latest', '$live'];
      expect(published).toEqual([expected]);
      expect(
        room
          .getLiveTimeline()
          .getEvents()
          .map((event) => event.getId())
      ).toEqual(expected);
      expect(room.findEventById('$latest')).toBe(latest);
      expect(room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBeNull();
    }
  );

  it('does not join an older cache page across an unknown sync gap', async () => {
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
    const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [message('$old', 100)], null);
    await room.addLiveEvents([new MatrixEvent(message('$live', 400))], { addToState: false });
    room.getLiveTimeline().setPaginationToken('gap-before', Direction.Backward);

    await openRoom(room, mx);

    expect(
      getLinkedTimelines(room.getLiveTimeline()).flatMap((part) =>
        part.getEvents().map((event) => event.getId())
      )
    ).toEqual(['$live']);
    expect(room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe('gap-before');
  });

  it('combines older history, cached edits, and a newer cached tail in timeline order', async () => {
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
    const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
    const loaded = new MatrixEvent(message('$loaded', 200));
    await room.addLiveEvents([loaded], { fromCache: true, addToState: false });
    room.getLiveTimeline().setPaginationToken('sdk-before', Direction.Backward);
    const edit = {
      ...message('$edit', 400),
      content: {
        msgtype: 'm.text',
        body: '* Updated root',
        'm.new_content': { msgtype: 'm.text', body: 'Updated root' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$loaded' },
      },
    };
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      message('$older', 100),
      { ...message('$loaded', 200), unsigned: { 'm.relations': { 'm.replace': edit } } },
      message('$newer', 300),
    ]);

    const published = await openRoom(room, mx);

    expect(published).toEqual([['$older', '$loaded', '$newer']]);
    expect(room.findEventById('$loaded')).toBe(loaded);
    expect(loaded.getContent().body).toBe('Updated root');
    expect(room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe('sdk-before');
  });

  it('does not apply history or its token to a live chain replaced during the cache read', async () => {
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
    const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [message('$old', 100), message('$tail', 200)],
      null
    );
    await room.addLiveEvents([new MatrixEvent(message('$tail', 200))], { addToState: false });

    const published = await openRoom(room, mx, () => room.resetLiveTimeline('new-gap', null));

    expect(published).toEqual([]);
    expect(room.getLiveTimeline().getEvents()).toEqual([]);
    expect(room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe('new-gap');
  });

  it.each([
    { hasLaterCachedTail: false, cachedTailArrivesLive: false },
    { hasLaterCachedTail: true, cachedTailArrivesLive: false },
    { hasLaterCachedTail: false, cachedTailArrivesLive: true },
  ])(
    'rechecks cache appends after decryption (later cache: $hasLaterCachedTail, same-id arrival: $cachedTailArrivesLive)',
    async ({ hasLaterCachedTail, cachedTailArrivesLive }) => {
      const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
      const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
      room.currentState.setStateEvents([
        new MatrixEvent({
          ...message('$encryption', 1),
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        }),
      ]);
      const loaded = new MatrixEvent(message('$loaded', 200));
      const encrypted = new MatrixEvent({
        ...message('$encrypted', 250),
        type: 'm.room.encrypted',
        content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'pending' },
      });
      await room.addLiveEvents([loaded, encrypted], { fromCache: true, addToState: false });
      const liveTimeline = room.getLiveTimeline();
      liveTimeline.setPaginationToken('sdk-before', Direction.Backward);
      const edit = {
        ...message('$edit', 350),
        content: {
          msgtype: 'm.text',
          body: '* Updated root',
          'm.new_content': { msgtype: 'm.text', body: 'Updated root' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$loaded' },
        },
      };
      await saveRoomEventsToCache(
        SESSION_ID,
        ROOM_ID,
        [
          message('$older', 100),
          { ...message('$loaded', 200), unsigned: { 'm.relations': { 'm.replace': edit } } },
          encrypted.event,
          {
            ...message('$stale-cache-tail', 300),
            unsigned: {
              'm.relations': {
                'm.replace': {
                  ...edit,
                  event_id: '$tail-edit',
                  content: {
                    ...edit.content,
                    'm.relates_to': { rel_type: 'm.replace', event_id: '$stale-cache-tail' },
                  },
                },
              },
            },
          },
          ...(hasLaterCachedTail ? [message('$later-cache-tail', 500)] : []),
        ],
        null
      );
      const arrivingCachedTail = new MatrixEvent(message('$stale-cache-tail', 300));
      const live = new MatrixEvent(message('$live', 400));
      vi.spyOn(mx, 'getCrypto').mockReturnValue({
        decryptEvent: async () => {
          await room.addLiveEvents(cachedTailArrivesLive ? [arrivingCachedTail, live] : [live], {
            addToState: false,
          });
          return { clearEvent: message('$encrypted', 250) };
        },
      } as unknown as ReturnType<MatrixClient['getCrypto']>);

      const published = await openRoom(room, mx);

      const expected = ['$older', '$loaded', '$encrypted'];
      if (cachedTailArrivesLive) expected.push('$stale-cache-tail');
      expected.push('$live');
      if (hasLaterCachedTail) expected.push('$later-cache-tail');
      expect(published).toEqual([expected]);
      expect(room.getLiveTimeline()).toBe(liveTimeline);
      expect(liveTimeline.getEvents().map((event) => event.getId())).toEqual(expected);
      expect(room.findEventById('$loaded')).toBe(loaded);
      expect(loaded.getContent().body).toBe('Updated root');
      if (cachedTailArrivesLive) {
        expect(room.findEventById('$stale-cache-tail')).toBe(arrivingCachedTail);
        expect(arrivingCachedTail.getContent().body).toBe('Updated root');
      }
      expect(liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();
    }
  );

  it('keeps the older pagination boundary if history grows during the cache read', async () => {
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: USER_ID });
    const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
    await saveRoomEventsToCache(
      SESSION_ID,
      ROOM_ID,
      [message('$old', 100), message('$tail', 200)],
      null
    );
    await room.addLiveEvents([new MatrixEvent(message('$tail', 200))], { addToState: false });

    await openRoom(room, mx, () => {
      room.addEventsToTimeline(
        [new MatrixEvent(message('$old', 100)), new MatrixEvent(message('$oldest', 50))],
        true,
        false,
        room.getLiveTimeline(),
        'older-history'
      );
    });

    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .map((event) => event.getId())
    ).toEqual(['$oldest', '$old', '$tail']);
    expect(room.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe('older-history');
  });

  it('publishes real thread roots while their SDK metadata requests remain stalled', async () => {
    class ThreadClient extends MatrixClient {
      constructor() {
        super({ baseUrl: 'https://example.org', userId: USER_ID });
        this.clientOpts = { threadSupport: true };
      }
    }
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const mx = new ThreadClient();
      vi.spyOn(mx, 'fetchRoomEvent').mockImplementation(() => new Promise(() => {}));
      const room = new Room(ROOM_ID, mx, USER_ID, { timelineSupport: true });
      const roots = ['$first', '$second', '$third'].map((id, index) => ({
        ...message(id, index + 1),
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 1,
              current_user_participated: false,
              latest_event: {
                ...message(`${id}-reply`, index + 10),
                content: {
                  body: 'Reply',
                  msgtype: 'm.text',
                  'm.relates_to': { rel_type: 'm.thread', event_id: id },
                },
              },
            },
          },
        },
      }));
      await saveRoomEventsToCache(SESSION_ID, ROOM_ID, roots, null);
      await room.addLiveEvents([new MatrixEvent(roots[2])], { fromCache: true, addToState: false });

      const published = await openRoom(room, mx);

      expect(published).toEqual([['$first', '$second', '$third']]);
      expect(
        room
          .getThreads()
          .map((thread) => thread.id)
          .sort()
      ).toEqual(['$first', '$second', '$third']);
    } finally {
      Thread.hasServerSideSupport = previousSupport;
    }
  });
});
