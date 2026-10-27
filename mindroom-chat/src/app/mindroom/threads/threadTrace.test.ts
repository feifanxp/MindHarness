// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, Room, type IEvent } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../engine/backfillScheduler';
import { scheduleReconcile } from '../engine/reconciler';
import {
  clearDeepTrace,
  initializeDeepTraceRecorder,
  readDeepTraceMemorySnapshot,
  setDeepTraceEnabled,
} from '../diagnostics/deepTrace';
import { createTimelineDebugTrace, logTimelineDebug } from './timelineDebug';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';

describe('anonymous thread diagnostics', () => {
  let dispose: () => void;
  beforeEach(async () => {
    window.localStorage.clear();
    dispose = initializeDeepTraceRecorder(window.localStorage);
    await clearDeepTrace();
  });
  afterEach(async () => {
    await setDeepTraceEnabled(false);
    dispose();
    await clearDeepTrace();
    vi.restoreAllMocks();
  });

  it('captures approved stages without console debug and excludes identifiers and arbitrary fields', async () => {
    const debugId = createTimelineDebugTrace(
      'thread-open',
      '!private-room:private.test',
      '$private-root'
    );
    const consoleLog = vi.spyOn(console, 'log');
    logTimelineDebug(debugId, 'thread-open-start');
    expect(readDeepTraceMemorySnapshot().events).toEqual([]);
    await setDeepTraceEnabled(true);
    logTimelineDebug(debugId, 'thread-open-start', { threadId: '$private-root' });
    logTimelineDebug(debugId, 'thread-cache-hydrate-applied', {
      appliedCount: 3,
      expectedReplyCount: 2,
      snapshotComplete: true,
      threadId: '$private-root',
      roomId: '!private-room:private.test',
      privateField: 123,
      error: new Error('private message text'),
    });
    logTimelineDebug(debugId, 'private-phase-name', { appliedCount: 99 });
    logTimelineDebug('thread-open#private#room', 'thread-open-start');
    const events = readDeepTraceMemorySnapshot().events.filter((event) =>
      event.name.startsWith('thread.')
    );
    expect(events).toHaveLength(2);
    const traceId = Number(debugId.split('#')[1]);
    expect(events[0]).toMatchObject({ name: 'thread.open.start', data: { trace_id: traceId } });
    expect(events[1]).toMatchObject({
      name: 'thread.cache.applied',
      data: {
        trace_id: traceId,
        applied_count: 3,
        expected_reply_count: 2,
        snapshot_complete: true,
      },
    });
    expect(JSON.stringify(events)).not.toContain('private');
    expect(consoleLog).not.toHaveBeenCalled();
    logTimelineDebug(debugId, 'reconcile-complete', { repaired: true, durable: false });
    expect(readDeepTraceMemorySnapshot().events.at(-1)?.data).toMatchObject({
      repaired: true,
      durable: false,
    });
    expect(
      createTimelineDebugTrace('thread-open', '!private-room:private.test', '$private-root')
    ).not.toBe(debugId);
  });

  it('records a failed cache read and each current or departed repair observer with its own open ID', async () => {
    await setDeepTraceEnabled(true);
    let current = 1;
    const callbacks: Array<(events: never[]) => void> = [];
    const room = { roomId: '!private-room:test', getThread: () => undefined };
    const ids = [1, 2].map(() => createTimelineDebugTrace('thread-open', room.roomId, '$private'));
    const append = vi.fn();
    for (let open = 1; open <= 2; open += 1) {
      current = open;
      await runThreadOpenCacheFirst({
        debugTraceId: ids[open - 1],
        room: room as never,
        threadId: '$private',
        shouldScrollToLatestOnOpen: true,
        threadOpenSeedSession: { applyInitialUntargetedThreadSeed: vi.fn() },
        isCurrentThreadOpen: () => current === open,
        pinThreadToBottomOnOpen: vi.fn(),
        hydrateThreadFromCache: async () => {
          throw new Error('private cache failure');
        },
        scheduleReconcile: async (args) => {
          callbacks.push(args.onRepaired!);
          return { repaired: false, fetchedCount: 0, iterations: 1, aborted: false };
        },
        setSupplementalThreadEvents: append,
        notifyEventsChanged: vi.fn(),
        onCacheHydrated: vi.fn(),
      });
    }
    callbacks.forEach((callback) => callback([]));
    const events = readDeepTraceMemorySnapshot().events;
    expect(events.filter((event) => event.name === 'thread.cache.error')).toHaveLength(2);
    expect(
      events
        .filter((event) => event.name === 'thread.reconcile.delivery')
        .map((event) => event.data)
    ).toEqual([
      { trace_id: Number(ids[0].split('#')[1]), current: false, mapped_count: 0 },
      { trace_id: Number(ids[1].split('#')[1]), current: true, mapped_count: 0 },
    ]);
    expect(append).not.toHaveBeenCalled();
  });

  it.each(['repaired', 'empty', 'rejected'])(
    'traces both opens sharing a real reconciliation job (%s)',
    async (outcome) => {
      await setDeepTraceEnabled(true);
      const mx = createClient({ baseUrl: 'https://example.test' });
      const room = new Room('!private-room:test', mx, '@private:test');
      mx.store.storeRoom(room);
      const scheduler = createBackfillScheduler({ mx, maxConcurrent: 1 });
      let release!: (value: { chunk: Partial<IEvent>[] }) => void;
      const held = new Promise<{ chunk: Partial<IEvent>[] }>((resolve) => {
        release = resolve;
      });
      const fetch = vi.spyOn(mx, 'fetchRelations').mockReturnValue(held as never);
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const ids = [1, 2].map(() =>
        createTimelineDebugTrace('thread-open', room.roomId, '$private-root')
      );
      const append = vi.fn();
      let current = 1;
      try {
        for (let open = 1; open <= 2; open += 1) {
          current = open;
          await runThreadOpenCacheFirst({
            debugTraceId: ids[open - 1],
            room,
            threadId: '$private-root',
            shouldScrollToLatestOnOpen: true,
            threadOpenSeedSession: { applyInitialUntargetedThreadSeed: vi.fn() },
            isCurrentThreadOpen: () => current === open,
            pinThreadToBottomOnOpen: vi.fn(),
            hydrateThreadFromCache: async () => undefined,
            scheduleReconcile: (args) =>
              scheduleReconcile({
                ...args,
                mx,
                scheduler,
                sessionId: 'diagnostic-test',
                debugTraceId: ids[open - 1],
                persistRepair: () => {
                  if (outcome === 'rejected') throw new Error('private repair failure');
                  return { write: Promise.resolve(true) } as never;
                },
                continuationStore: {
                  load: async () => undefined,
                  begin: async (_session, _room, _thread, candidate) => candidate,
                  checkpoint: async () => undefined,
                  clear: async () => true,
                  restartFromHead: async () => undefined,
                },
              }),
            setSupplementalThreadEvents: append,
            notifyEventsChanged: vi.fn(),
            onCacheHydrated: vi.fn(),
          });
        }
        const reply: Partial<IEvent> = {
          event_id: '$private-reply',
          room_id: room.roomId,
          sender: '@private:test',
          type: 'm.room.message',
          origin_server_ts: 1,
          content: {
            body: 'private body',
            msgtype: 'm.text',
            'm.relates_to': { rel_type: 'm.thread', event_id: '$private-root' },
          },
        };
        release({ chunk: outcome === 'empty' ? [] : [reply] });
        const eventName =
          outcome === 'rejected' ? 'thread.reconcile.error' : 'thread.reconcile.settled';
        await vi.waitFor(() =>
          expect(
            readDeepTraceMemorySnapshot().events.filter((event) => event.name === eventName)
          ).toHaveLength(2)
        );
        const events = readDeepTraceMemorySnapshot().events;
        expect(fetch).toHaveBeenCalledOnce();
        expect(
          events.filter((event) => event.name === eventName).map((event) => event.data?.trace_id)
        ).toEqual(ids.map((id) => Number(id.split('#')[1])));
        if (outcome === 'repaired') {
          expect(append).toHaveBeenCalledOnce();
          expect(
            events
              .filter((event) => event.name === 'thread.reconcile.settled')
              .map((event) => event.data?.durable)
          ).toEqual([true, true]);
          expect(
            events
              .filter((event) => event.name === 'thread.reconcile.delivery')
              .map((event) => event.data?.current)
          ).toEqual([false, true]);
          expect(events.filter((event) => event.name === 'thread.reconcile.complete')).toHaveLength(
            1
          );
          expect(
            events.find((event) => event.name === 'thread.reconcile.chunk')?.data?.reply_count
          ).toBe(1);
        } else expect(append).not.toHaveBeenCalled();
        expect(JSON.stringify(events)).not.toContain('private');
        if (outcome === 'rejected') expect(warning).toHaveBeenCalledTimes(2);
      } finally {
        release({ chunk: [] });
        scheduler.abortAll();
        mx.http.abort();
      }
    }
  );
});
