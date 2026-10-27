import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ClientEvent,
  createClient,
  MatrixEvent,
  ReceiptType,
  Room,
  SyncState,
  type IEvent,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { getThreadUnread } from './roomThreadList';
import { buildThreadRecord } from './threadRecord';
import { SHOWN_THREAD_DWELL_MS, useInitializeShownThread } from './useInitializeShownThread';

const roomId = '!room:example.org';
const me = '@alice:example.org';
const bob = '@bob:example.org';
const rootId = '$root';

const message = (eventId: string, ts: number, sender = bob, threadRoot?: string): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(threadRoot ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRoot } } : {}),
    },
  } as IEvent);
/** A root as listed by /threads: bob's latest reply at ts 300 is known only from this summary. */
const listedRoot = (count: number): IEvent => ({
  ...message(rootId, 100, me),
  unsigned: {
    'm.relations': {
      'm.thread': {
        count,
        current_user_participated: true,
        latest_event: message('$summary-reply', 300, bob, rootId),
      },
    },
  },
});

const fixture = (createNodeMock: () => unknown = () => ({})) => {
  const requests: string[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: me,
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      requests.push(path);
      if (path.includes('/event/')) return json(listedRoot(2));
      return json({ chunk: [message('$summary-reply', 300, bob, rootId)], next_batch: 'older' });
    },
  });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const room = new Room(roomId, mx, me, { timelineSupport: true });
  mx.store.storeRoom(room);
  room.processThreadRoots([mx.getEventMapper()(listedRoot(2))], true);
  const thread = room.getThread(rootId)!;
  // Alice read the thread up to ts 200.
  room.addReceipt(
    new MatrixEvent({
      type: 'm.receipt',
      room_id: roomId,
      content: { $read: { [ReceiptType.Read]: { [me]: { thread_id: rootId, ts: 200 } } } },
    })
  );
  const Card = () => <div ref={useInitializeShownThread(roomId, rootId)} />;
  let renderer: ReactTestRenderer | undefined;
  const render = () =>
    act(() => {
      const element = (
        <MatrixClientProvider value={mx}>
          <Card />
        </MatrixClientProvider>
      );
      if (renderer) renderer.update(element);
      // Node has no IntersectionObserver, so a mounted card counts as on screen.
      else renderer = create(element, { createNodeMock });
    });
  const unmount = () =>
    act(() => {
      renderer?.unmount();
      renderer = undefined;
    });
  const goLive = (previous = SyncState.Prepared) =>
    act(() => {
      mx.emit(ClientEvent.Sync, SyncState.Syncing, previous);
    });
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(SHOWN_THREAD_DWELL_MS);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
  return { mx, room, thread, requests, render, unmount, goLive, settle };
};

describe('useInitializeShownThread', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    vi.useFakeTimers();
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    vi.useRealTimers();
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('loads a shown thread once after the first live sync', async () => {
    const f = fixture();
    // A summary-only thread already reflects its newest reply in counts and unread state.
    expect(f.thread.length).toBe(2);
    expect(getThreadUnread(f.thread, me)).toBe(true);
    expect(
      buildThreadRecord({ room: f.room, threadRootId: rootId, currentUserId: me }).status.isUnread
    ).toBe(true);

    f.render();
    await f.settle();
    expect(f.requests).toEqual([]);

    f.goLive();
    await f.settle();
    expect(f.thread.initialEventsFetched).toBe(true);
    const loaded = f.requests.length;
    expect(loaded).toBe(2);

    f.render();
    f.unmount();
    f.render();
    f.goLive(SyncState.Syncing);
    await f.settle();
    expect(f.requests).toHaveLength(loaded);

    // A live reply on the shown thread counts once and stays unread.
    await f.room.addLiveEvents([new MatrixEvent(message('$live', 400, bob, rootId))], {
      addToState: false,
    });
    await f.settle();
    expect(f.thread.length).toBe(3);
    expect(f.thread.replyToEvent?.getId()).toBe('$live');
    expect(getThreadUnread(f.thread, me)).toBe(true);
    expect(f.requests).toHaveLength(loaded);
    f.unmount();
  });

  it('loads only cards that stay on screen', async () => {
    let report!: (visible: boolean) => void;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Array<Partial<IntersectionObserverEntry>>) => void) {
          report = (visible) => callback([{ target: card, isIntersecting: visible }]);
        }

        observe = vi.fn();

        unobserve = vi.fn();
      }
    );
    const card = {} as Element;
    const f = fixture(() => card);
    const initialize = vi.spyOn(f.thread, 'initialize').mockReturnValue(undefined);
    f.render();
    f.goLive();
    await f.settle();
    // Rendered below the fold.
    expect(initialize).not.toHaveBeenCalled();

    act(() => report(true));
    act(() => report(false));
    await f.settle();
    expect(initialize).not.toHaveBeenCalled();

    act(() => report(true));
    await f.settle();
    expect(initialize).toHaveBeenCalledOnce();
    f.unmount();
    vi.unstubAllGlobals();
  });

  it('loads a thread that the SDK creates after its card rendered', async () => {
    const f = fixture();
    const Card = () => <div ref={useInitializeShownThread(roomId, '$later')} />;
    act(() => {
      create(
        <MatrixClientProvider value={f.mx}>
          <Card />
        </MatrixClientProvider>,
        { createNodeMock: () => ({}) }
      );
    });
    f.goLive();
    await f.settle();

    f.room.processThreadRoots(
      [f.mx.getEventMapper()({ ...listedRoot(1), event_id: '$later' })],
      true
    );
    await f.settle();

    expect(f.room.getThread('$later')!.initialEventsFetched).toBe(true);
  });

  it('skips cards scrolled past and retries a failed load after reconnecting', async () => {
    const f = fixture();
    f.render();
    f.goLive();
    f.unmount();
    await f.settle();
    expect(f.requests).toEqual([]);

    const initialize = vi.spyOn(f.thread, 'initialize').mockReturnValue(undefined);
    f.render();
    await f.settle();
    expect(initialize).toHaveBeenCalledOnce();
    f.goLive(SyncState.Reconnecting);
    await f.settle();
    expect(initialize).toHaveBeenCalledTimes(2);
    f.unmount();
  });
});
