import React, { useCallback, useEffect, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createClient, Direction, MatrixEvent, Room, RoomEvent, type IEvent } from 'matrix-js-sdk';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindroomSyncEngine, type MindroomSyncEngine } from '../engine';
import {
  __setCacheStoreByteBudgetForTests,
  deleteCacheStoreDb,
  loadLatestCachedThreadEvents,
  saveRoomEventsToCacheCommitted,
} from './cacheStore';
import { useThreadTimelineState } from './useThreadTimelineState';
import { keepRecoveredEventsInLoadedSpan, useThreadGapRecovery } from './useThreadGapRecovery';
import * as cacheController from './threadOpenCacheController';

const ROOM_ID = '!recovery:example.org';
const ROOT_ID = '$root';
const USER_ID = '@alice:example.org';

const message = (id: string, body: string, threadId = ROOT_ID): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM_ID,
  sender: USER_ID,
  type: 'm.room.message',
  origin_server_ts: 10,
  content: {
    body,
    msgtype: 'm.text',
    'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
  },
});

function Harness({
  engine,
  room,
  threadId,
  loaded,
}: {
  engine: MindroomSyncEngine;
  room: Room;
  threadId: string;
  loaded?: MatrixEvent[];
}) {
  const { threadEvents, setSupplementalThreadEvents } = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated: true,
  });
  const loadedEventsRef = useRef(threadEvents);
  loadedEventsRef.current = threadEvents;
  const getLoadedEvents = useCallback(() => loadedEventsRef.current, []);
  useEffect(() => {
    if (loaded) setSupplementalThreadEvents(threadId, loaded);
  }, [loaded, setSupplementalThreadEvents, threadId]);
  useThreadGapRecovery({
    engine,
    room,
    threadId,
    append: setSupplementalThreadEvents,
    getLoadedEvents,
  });
  return (
    <>
      {threadEvents.map((event) => (
        <span key={event.getId()}>{event.getContent().body}</span>
      ))}
    </>
  );
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  __setCacheStoreByteBudgetForTests(undefined);
});

const isRelationsRequest = (input: RequestInfo | URL) => String(input).includes('/relations/');

const setup = (
  chunks: Partial<IEvent>[][],
  loaded?: MatrixEvent[],
  relations: Partial<IEvent>[] = [],
  render: (engine: MindroomSyncEngine, room: Room) => React.ReactElement = (engine, room) => (
    <Harness engine={engine} room={room} threadId={ROOT_ID} loaded={loaded} />
  )
) => {
  const fetchFn = vi.fn(
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          isRelationsRequest(input)
            ? { chunk: relations }
            : { chunk: chunks.shift() ?? [], ...(chunks.length ? { end: 'older' } : {}) }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  const mx = createClient({ baseUrl: 'https://example.org', userId: USER_ID, fetchFn });
  const room = new Room(ROOM_ID, mx, USER_ID);
  mx.store.storeRoom(room);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.create',
      state_key: '',
      sender: USER_ID,
      content: { creator: USER_ID },
      event_id: '$create',
      room_id: ROOM_ID,
    }),
  ]);
  room.getLiveTimeline().setPaginationToken('gap', Direction.Backward);
  const engine = createMindroomSyncEngine({
    mx,
    getPrefetchConfig: () => ({ scope: 'all-rooms' }),
  });
  engine.start();
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(render(engine, room));
  });
  cleanups.push(async () => {
    act(() => renderer.unmount());
    engine.stop();
    await deleteCacheStoreDb(engine.sessionId);
  });
  // The SDK emits a limited sync's reset on the room and re-emits it on the client.
  // `onRoom: false` leaves only the engine's gap fill to react.
  const recover = ({ onRoom = true } = {}) => {
    if (onRoom) room.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), false);
    mx.emit(RoomEvent.TimelineReset, room, room.getUnfilteredTimelineSet(), false);
  };
  return { mx, room, engine, renderer: renderer!, fetchFn, recover };
};

describe('mounted thread gap recovery', () => {
  it.each([false, true])(
    'does not lose a commit during an in-flight cache read (read fails: %s)',
    async (failRead) => {
      let releaseRead!: () => void;
      const heldRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let snapshotTaken!: () => void;
      const snapshotReady = new Promise<void>((resolve) => {
        snapshotTaken = resolve;
      });
      const hydrate = cacheController.hydrateThreadFromCache;
      vi.spyOn(cacheController, 'hydrateThreadFromCache').mockImplementationOnce(
        async (...args) => {
          const page = await hydrate(...args);
          snapshotTaken();
          await heldRead;
          if (failRead) throw new Error('Read interrupted');
          return page;
        }
      );
      let releasePage!: (response: Response) => void;
      const heldPage = new Promise<Response>((resolve) => {
        releasePage = resolve;
      });
      const { fetchFn, recover, renderer, engine } = setup([]);
      fetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify({ chunk: [message('$first', 'First')], end: 'older' }))
      );
      fetchFn.mockImplementationOnce(() => heldPage);
      await act(async () => {
        recover({ onRoom: false });
        await snapshotReady;
      });
      await act(async () => {
        releasePage(new Response(JSON.stringify({ chunk: [message('$second', 'Second')] })));
        await vi.waitFor(async () =>
          expect(
            (
              await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
            ).events
          ).toHaveLength(2)
        );
        releaseRead();
      });
      await act(async () => {
        await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Second'));
      });
    }
  );

  it('renders a committed missing reply and its final edit without reopening or an SDK thread', async () => {
    const reply = message('$reply', 'Working');
    reply.unsigned = {
      'm.relations': {
        'm.replace': {
          ...message('$edit', '* Sent'),
          origin_server_ts: 20,
          content: {
            'm.new_content': { body: 'Sent', msgtype: 'm.text' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
          },
        },
      },
    };
    const { room, engine, renderer, recover } = setup([
      [reply, message('$other', 'Other thread', '$elsewhere')],
    ]);
    expect(room.getThread(ROOT_ID)).toBeNull();
    await act(async () => {
      recover();
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events
        ).toHaveLength(1)
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Sent'));
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Other thread');
  });

  it('does not put a recovered reply into a different thread after navigation', async () => {
    const { renderer, engine, room, recover } = setup([[message('$reply', 'Recovered')]]);
    await act(async () => {
      recover();
      renderer.update(<Harness engine={engine} room={room} threadId="$elsewhere" />);
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events
        ).toHaveLength(1)
      );
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Recovered');
  });

  it('measures the loaded span from replies, not edits or reactions rendered among them', () => {
    const at = (event: Partial<IEvent>, ts: number) =>
      new MatrixEvent({ ...event, origin_server_ts: ts });
    const reaction = at(
      {
        event_id: '$reaction',
        room_id: ROOM_ID,
        sender: USER_ID,
        type: 'm.reaction',
        content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: ROOT_ID, key: '👍' } },
      },
      5
    );
    const loaded = [
      at(message(ROOT_ID, 'Root'), 1),
      reaction,
      at(message('$loaded', 'Loaded'), 20),
    ];
    const older = at(message('$older', 'Older history'), 10);
    const missed = at(message('$missed', 'Missed reply'), 30);

    expect(
      keepRecoveredEventsInLoadedSpan(ROOT_ID, [older, missed], loaded).map((e) => e.getId())
    ).toEqual(['$missed']);
  });

  it('restores recovered replies inside the loaded span but leaves older history to Load Older', async () => {
    const loaded = new MatrixEvent({ ...message('$loaded', 'Loaded'), origin_server_ts: 20 });
    const older = { ...message('$older', 'Older history'), origin_server_ts: 5 };
    const missed = { ...message('$missed', 'Missed reply'), origin_server_ts: 30 };
    const { engine, renderer, recover } = setup([[missed, older]], [loaded]);
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Loaded'));
    });
    await act(async () => {
      recover();
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events
        ).toHaveLength(2)
      );
    });
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Missed reply'));
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Older history');
  });

  it('shows a reply missed in a sync gap when a full cache keeps the room gap unfilled', async () => {
    const loaded = new MatrixEvent({ ...message('$loaded', 'Loaded'), origin_server_ts: 20 });
    const missed = { ...message('$missed', 'Missed reply'), origin_server_ts: 30 };
    const { engine, renderer, recover, fetchFn } = setup(
      [],
      [loaded],
      [missed, message('$loaded', 'Loaded')]
    );
    await saveRoomEventsToCacheCommitted(engine.sessionId, ROOM_ID, [message('$cached', 'Cached')]);
    // Over its byte budget, the cache refuses gap pages for every room.
    __setCacheStoreByteBudgetForTests(1);
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Loaded'));
    });
    await act(async () => {
      recover();
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Missed reply'));
    });
    expect(fetchFn.mock.calls.some(([input]) => String(input).includes('/messages'))).toBe(false);
  });

  const holdRelations = (fetchFn: ReturnType<typeof setup>['fetchFn']) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const respond = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (input) => {
      if (isRelationsRequest(input)) await held;
      return respond(input);
    });
    const requested = () =>
      vi.waitFor(() =>
        expect(fetchFn.mock.calls.some(([input]) => isRelationsRequest(input))).toBe(true)
      );
    return { release, requested };
  };

  it('reconciles again after a thread-open pass that was already running at the reset', async () => {
    const missed = { ...message('$missed', 'Missed reply'), origin_server_ts: 30 };
    const { engine, renderer, recover } = setup([], undefined, [missed]);
    let finishOpenPass: (() => void) | undefined;
    // An open's reconcile fetched before the gap and found nothing new.
    const openPass = engine.scheduler.enqueue({
      roomId: ROOM_ID,
      threadId: ROOT_ID,
      kind: 'reconcile',
      priority: 0,
      execute: () =>
        new Promise((resolve) => {
          finishOpenPass = () =>
            resolve({ repaired: false, fetchedCount: 0, iterations: 1, aborted: false });
        }),
    });
    const enqueue = vi.spyOn(engine.scheduler, 'enqueue');
    const pendingJobs = vi.spyOn(engine.scheduler, 'pendingJobs');
    await act(async () => {
      await vi.waitFor(() => expect(finishOpenPass).toBeDefined());
      recover();
      // The reset's pass reaches the scheduler while the open pass runs.
      await vi.waitFor(() =>
        expect(
          pendingJobs.mock.calls.length > 0 ||
            enqueue.mock.calls.some(([job]) => job.kind === 'reconcile')
        ).toBe(true)
      );
    });
    await act(async () => {
      finishOpenPass!();
      await openPass;
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Missed reply'));
    });
  });

  it('hands a reconciled reply to the current callback when it changes during the pass', async () => {
    function AppendHarness({
      engine,
      room,
      append,
    }: {
      engine: MindroomSyncEngine;
      room: Room;
      append: (threadId: string, events: MatrixEvent[]) => void;
    }) {
      useThreadGapRecovery({ engine, room, threadId: ROOT_ID, append });
      return null;
    }
    const first = vi.fn();
    const second = vi.fn();
    const missed = { ...message('$missed', 'Missed reply'), origin_server_ts: 30 };
    const { engine, room, renderer, recover, fetchFn } = setup([], undefined, [missed], (e, r) => (
      <AppendHarness engine={e} room={r} append={first} />
    ));
    const relations = holdRelations(fetchFn);
    await act(async () => {
      recover();
      await relations.requested();
    });
    // The render callback changes identity when the SDK creates the thread.
    act(() => renderer.update(<AppendHarness engine={engine} room={room} append={second} />));
    await act(async () => {
      relations.release();
      await vi.waitFor(() =>
        expect(
          second.mock.calls.flatMap(([, events]: [string, MatrixEvent[]]) =>
            events.map((event) => event.getId())
          )
        ).toContain('$missed')
      );
    });
    expect(first).not.toHaveBeenCalled();
  });

  it('does not render a reconciled reply after navigating to another thread', async () => {
    const missed = { ...message('$missed', 'Missed reply'), origin_server_ts: 30 };
    const { engine, room, renderer, recover, fetchFn } = setup([], undefined, [missed]);
    const relations = holdRelations(fetchFn);
    await act(async () => {
      recover();
      await relations.requested();
    });
    const elsewhere = new MatrixEvent(message('$elsewhere-reply', 'Elsewhere', '$elsewhere'));
    act(() =>
      renderer.update(
        <Harness engine={engine} room={room} threadId="$elsewhere" loaded={[elsewhere]} />
      )
    );
    await act(async () => {
      await vi.waitFor(() => expect(JSON.stringify(renderer.toJSON())).toContain('Elsewhere'));
    });
    await act(async () => {
      relations.release();
      await vi.waitFor(async () =>
        expect(
          (
            await loadLatestCachedThreadEvents(engine.sessionId, ROOM_ID, ROOT_ID, 20)
          ).events.map((event) => event.event_id)
        ).toContain('$missed')
      );
    });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Elsewhere');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Missed reply');
  });
});
