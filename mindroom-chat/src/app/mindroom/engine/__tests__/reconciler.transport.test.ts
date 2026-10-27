import { createClient, Room, type IEvent } from 'matrix-js-sdk';
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { beginThreadReconcileContinuation, deleteCacheStoreDb } from '../../threads/cacheStore';

const ROOM_ID = '!room:example.org';
const ROOT_ID = '$root';
const DEADLINE_MS = 15_000;
const reply: Partial<IEvent> = {
  event_id: '$reply',
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: {
    body: 'Sent',
    msgtype: 'm.text',
    'm.relates_to': { rel_type: 'm.thread', event_id: ROOT_ID },
  },
};
const json = (chunk: Partial<IEvent>[]) =>
  new Response(JSON.stringify({ chunk }), { headers: { 'Content-Type': 'application/json' } });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});

const setup = (heldAttempts: number) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const signals: AbortSignal[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    if (signals.length >= heldAttempts) return json([reply]);
    const signal = options!.signal!;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    });
  });
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    fetchFn,
  });
  const room = new Room(ROOM_ID, mx, '@alice:example.org');
  mx.store.storeRoom(room);
  const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
  const sessionId = `transport-${heldAttempts}`;
  const results: Promise<unknown>[] = [];
  const reconcile = (onRepaired = vi.fn()) => {
    const result = scheduleReconcile({
      mx,
      room,
      roomId: ROOM_ID,
      threadId: ROOT_ID,
      sessionId,
      scheduler,
      onRepaired,
    });
    results.push(result.catch(() => undefined));
    return result;
  };
  cleanups.push(async () => {
    scheduler.abortAll();
    mx.http.abort();
    await Promise.all(results);
    await deleteCacheStoreDb(sessionId);
  });
  return { mx, room, scheduler, reconcile, fetchFn, signals, sessionId };
};

describe('reconciliation transport recovery', () => {
  it('aborts a stalled HTTP request and repairs every coalesced observer on one fresh retry', async () => {
    const { reconcile, signals, fetchFn } = setup(1);
    const firstObserver = vi.fn();
    const currentObserver = vi.fn();
    const first = reconcile(firstObserver);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const reopened = reconcile(currentObserver);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    expect(signals[0].aborted).toBe(true);
    await expect(reopened).resolves.toMatchObject({ repaired: true, aborted: false });
    await first;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(
      currentObserver.mock.calls[0][0].some(
        (event: { getId(): string }) => event.getId() === '$reply'
      )
    ).toBe(true);
    expect(firstObserver).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'bounds retries and permits a fresh reopen (saved cursor: %s)',
    async (savedCursor) => {
      const { reconcile, scheduler, fetchFn, signals, sessionId } = setup(2);
      if (savedCursor)
        await beginThreadReconcileContinuation(sessionId, ROOM_ID, ROOT_ID, {
          generation: 'saved',
          startedAt: 1,
          nextToken: 'older',
          overlapEventIds: [],
        });
      const first = reconcile();
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
      const otherJob = vi.fn(async () => 'next');
      const queued = scheduler.enqueue({
        roomId: '!other:example.org',
        kind: 'reconcile',
        priority: 0,
        execute: otherJob,
      });
      await vi.advanceTimersByTimeAsync(DEADLINE_MS * 2);
      expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
      await expect(first).resolves.toMatchObject({ repaired: false });
      await expect(queued).resolves.toBe('next');
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(
        fetchFn.mock.calls.slice(0, 2).map(([url]) => new URL(String(url)).searchParams.get('from'))
      ).toEqual(savedCursor ? ['older', 'older'] : [null, null]);
      await expect(reconcile()).resolves.toMatchObject({ repaired: true });
    }
  );

  it('cancels an in-flight HTTP request on scheduler abort without retrying', async () => {
    const { reconcile, scheduler, fetchFn, signals } = setup(1);
    const result = reconcile();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    scheduler.abortAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0].aborted).toBe(true);
    await result.catch(() => undefined);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
