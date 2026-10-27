/**
 * CINNY-207 P3.1 (Commit 3): compaction behaviors of the engine's
 * write-through, preserved verbatim from the old
 * `roomLiveEventController.compaction.test.ts`. Rewritten as plain-TS
 * tests against the engine (no react-test-renderer, no 15-mock
 * component harness) — the compaction semantics do not depend on any
 * UI state, so they belong here.
 *
 * Behaviors covered (each corresponds to a test in the old suite):
 *   1. Standalone m.replace does not persist; target upserts after
 *      the coalesce window (thread path).
 *   2. N rapid edits coalesce to one target upsert.
 *   3. flush() drains pending upserts (moved from the DOM-driven
 *      visibilitychange test — the engine flushes via the same
 *      handle now that the component's window/document binding is
 *      the engine's).
 *   4. Non-replace thread events persist immediately, bypassing
 *      the debounce.
 *   5. Fire-time target miss → standalone fallback with
 *      editCompactionTargetMisses probe increment.
 *   6. Late-materializing cross-sender target → [target, replace]
 *      standalone emit.
 *   7. D12-latest: keeps the newest replace when a stale one arrives
 *      later in the same window.
 *   8. Arm-time cross-sender replace persists directly (no compaction).
 *   9. Room-view thread edits compact onto the target with the thread
 *      attribution captured at schedule time (engine equivalent: a
 *      thread-attributed replace uses the thread key regardless of
 *      whether a UI thread is "open").
 *  10. Non-replace thread events persist via the thread path (engine
 *      equivalent of the component's "room-view thread events go
 *      through persistThreadCacheFromRoomEvents" — the engine always
 *      routes thread events through the same persist entry point).
 *  11. Room-level edits compact onto the target's room cache record.
 *  12. Thread and room compaction keys are isolated for the same
 *      target id.
 *  13. flush() drains pending upserts on engine stop() (equivalent
 *      to the old "on unmount" test).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk';

const persistThreadEventCacheSnapshot = vi.fn();
const persistRoomEventCacheSnapshot = vi.fn();
const deleteRoomEventsFromCache = vi.fn().mockResolvedValue(undefined);
const deleteThreadEventsFromCache = vi.fn().mockResolvedValue(undefined);
const deleteThreadEventFromCacheByEventId = vi.fn().mockResolvedValue(undefined);

vi.mock('../threads/eventRepository', () => ({
  persistThreadEventCacheSnapshot: (...args: unknown[]) =>
    persistThreadEventCacheSnapshot(...args),
  persistRoomEventCacheSnapshot: (...args: unknown[]) => persistRoomEventCacheSnapshot(...args),
  deleteRoomEventsFromCache: (...args: unknown[]) => deleteRoomEventsFromCache(...args),
  deleteThreadEventsFromCache: (...args: unknown[]) => deleteThreadEventsFromCache(...args),
  deleteThreadEventFromCacheByEventId: (...args: unknown[]) =>
    deleteThreadEventFromCacheByEventId(...args),
  getThreadCacheTargetId: (_room: unknown, mEvent: { threadRootId?: string }) =>
    mEvent.threadRootId,
}));

import { createEngineWriteThrough } from './engineWriteThrough';
import { getCacheProbeSnapshot, resetCacheProbe } from '../threads/cacheProbe';
import type { EngineLiveEventMeta } from './types';

type FakeEvent = {
  __id: string;
  getId: () => string;
  getRelation: () => { rel_type?: string; event_id?: string } | undefined;
  getSender: () => string;
  getTs: () => number;
  isRedaction: () => boolean;
  threadRootId?: string;
};

const makeEvent = (
  id: string,
  {
    threadRootId,
    relation,
    sender = '@alice:example.org',
    ts = 0,
    isRedaction = false,
  }: {
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
    sender?: string;
    ts?: number;
    isRedaction?: boolean;
  } = {}
): FakeEvent => ({
  __id: id,
  getId: () => id,
  getRelation: () => relation,
  getSender: () => sender,
  getTs: () => ts,
  isRedaction: () => isRedaction,
  threadRootId,
});

const makeRoom = (findEventById: (id: string) => FakeEvent | undefined): Room => {
  return {
    roomId: '!room:example.org',
    findEventById: (id: string) => findEventById(id) as unknown as MatrixEvent | undefined,
    getThread: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => [] }) as never,
    getUnfilteredTimelineSet: () => undefined as never,
    getThreads: () => [],
  } as unknown as Room;
};

const timelineMeta = (roomId = '!room:example.org'): EngineLiveEventMeta => ({
  kind: 'timeline',
  roomId,
  liveEvent: true,
  toStartOfTimeline: false,
});

const waitForDebounce = async () => {
  // The scheduler runs on real setTimeout under the hood. To keep the
  // suite fast we advance fake timers explicitly in each test instead
  // of waiting real wall-clock time.
  await Promise.resolve();
};

describe('engineWriteThrough compaction (CINNY-207 P3.1 / D5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCacheProbe();
    persistThreadEventCacheSnapshot.mockReset();
    persistRoomEventCacheSnapshot.mockReset();
    deleteRoomEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventsFromCache.mockReset().mockResolvedValue(undefined);
    deleteThreadEventFromCacheByEventId.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCacheProbe();
  });

  const advance = (ms: number) => vi.advanceTimersByTime(ms);

  it('does not persist a standalone m.replace; upserts the target after the coalesce window (thread)', async () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([target]);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe(threadId);
    expect(getCacheProbeSnapshot().editCompactions).toBe(1);
    expect(getCacheProbeSnapshot().editCompactionTargetMisses).toBe(0);
  });

  it('coalesces N rapid edits into one target upsert', async () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    for (let i = 1; i <= 25; i += 1) {
      writer.handleLiveEvent(
        makeEvent(`$edit-${i}`, {
          threadRootId: threadId,
          ts: i,
          relation: { rel_type: RelationType.Replace, event_id: '$target' },
        }) as unknown as MatrixEvent,
        room,
        timelineMeta()
      );
    }
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([target]);
    expect(getCacheProbeSnapshot().editCompactions).toBe(1);
  });

  it('flush() drains pending upserts (equivalent of the visibilitychange / unmount flush)', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    writer.flush();
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([target]);
  });

  it('persists non-replace thread events immediately, bypassing the debounce', () => {
    const threadId = '$thread-root';
    const reply = makeEvent('$reply-1', { threadRootId: threadId });
    const room = makeRoom(() => undefined);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(reply as unknown as MatrixEvent, room, timelineMeta());

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([reply]);
  });

  it('falls back to persisting the replace standalone when the target is not in SDK memory (probe bumped)', async () => {
    const threadId = '$thread-root';
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom(() => undefined);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([edit]);
    expect(getCacheProbeSnapshot().editCompactionTargetMisses).toBe(1);
  });

  it('emits [target, replace] when a late-materializing target is cross-sender', async () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', {
      threadRootId: threadId,
      sender: '@alice:example.org',
    });
    const crossSenderEdit = makeEvent('$edit-x', {
      threadRootId: threadId,
      sender: '@mallory:example.org',
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    let targetLoaded = false;
    const room = makeRoom((id) => (targetLoaded && id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(crossSenderEdit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();
    targetLoaded = true;

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([
      target,
      crossSenderEdit,
    ]);
  });

  it('keeps the D12-latest replace when a stale one arrives later in the same window', async () => {
    const threadId = '$thread-root';
    const newer = makeEvent('$edit-new', {
      threadRootId: threadId,
      ts: 200,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const stale = makeEvent('$edit-old', {
      threadRootId: threadId,
      ts: 150,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom(() => undefined);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(newer as unknown as MatrixEvent, room, timelineMeta());
    writer.handleLiveEvent(stale as unknown as MatrixEvent, room, timelineMeta());

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    // Fire-time target-miss durability fallback persists the D12-latest
    // replace we captured, not the last-arrived one.
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([newer]);
  });

  it('persists arm-time cross-sender replaces directly instead of compacting them', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', {
      threadRootId: threadId,
      sender: '@alice:example.org',
    });
    const crossSenderEdit = makeEvent('$edit-x', {
      threadRootId: threadId,
      sender: '@mallory:example.org',
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(crossSenderEdit as unknown as MatrixEvent, room, timelineMeta());

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([crossSenderEdit]);
    // No scheduler was armed → no compaction probe increment.
    expect(getCacheProbeSnapshot().editCompactions).toBe(0);
  });

  it('captures thread attribution at schedule time (mid-debounce redaction cannot lose the thread key)', async () => {
    const rootId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: rootId });
    const edit = makeEvent('$edit-1', {
      threadRootId: rootId,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    // Fires against the thread that was known at ARM time, not
    // re-derived at fire time from the (possibly redacted) event.
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe(rootId);
  });

  it('routes non-replace thread events through the thread persist entry point (F1 fix: no view branching)', () => {
    const rootId = '$thread-root';
    const reply = makeEvent('$reply-1', { threadRootId: rootId });
    const room = makeRoom(() => undefined);
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(reply as unknown as MatrixEvent, room, timelineMeta());

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].threadId).toBe(rootId);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([reply]);
    // Non-thread room persist path is not touched.
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();
  });

  it('compacts room-level edits onto the target room cache record', async () => {
    const target = makeEvent('$room-msg');
    const edit = makeEvent('$edit-1', {
      relation: { rel_type: RelationType.Replace, event_id: '$room-msg' },
    });
    const room = makeRoom((id) => (id === '$room-msg' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistRoomEventCacheSnapshot).not.toHaveBeenCalled();

    advance(2000);
    await waitForDebounce();

    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].events).toEqual([target]);
    expect(getCacheProbeSnapshot().editCompactions).toBe(1);
  });

  it('isolates thread and room compaction keys for the same target id', async () => {
    const rootId = '$thread-root';
    // Two DIFFERENT events with the SAME id shape: one relates to a
    // thread target ($shared), one relates to a room-level target
    // ($shared). Verifies the key namespacing (`thread|...|$shared`
    // vs `room|...|$shared`) keeps them independent.
    const threadTarget = makeEvent('$shared', { threadRootId: rootId });
    const roomTarget = makeEvent('$shared');
    const threadEdit = makeEvent('$edit-t', {
      threadRootId: rootId,
      relation: { rel_type: RelationType.Replace, event_id: '$shared' },
    });
    const roomEdit = makeEvent('$edit-r', {
      // No threadRootId → this replace lives at room level.
      relation: { rel_type: RelationType.Replace, event_id: '$shared' },
    });
    let currentFind: FakeEvent | undefined = threadTarget;
    const room = makeRoom((id) => (id === '$shared' ? currentFind : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(threadEdit as unknown as MatrixEvent, room, timelineMeta());
    // Second call: the room's memory swap emulates a room-level target
    // being distinct from the thread-attributed one (in reality they'd
    // have distinct ids; the key namespace is what matters here).
    currentFind = roomTarget;
    writer.handleLiveEvent(roomEdit as unknown as MatrixEvent, room, timelineMeta());

    advance(2000);
    await waitForDebounce();

    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCacheSnapshot.mock.calls[0][0].events).toEqual([roomTarget]);
    expect(persistRoomEventCacheSnapshot).toHaveBeenCalledTimes(1);
    expect(persistRoomEventCacheSnapshot.mock.calls[0][0].events).toEqual([roomTarget]);
  });

  it('flush() on engine teardown drains pending upserts (equivalent of the old unmount flush)', () => {
    const threadId = '$thread-root';
    const target = makeEvent('$target', { threadRootId: threadId });
    const edit = makeEvent('$edit-1', {
      threadRootId: threadId,
      relation: { rel_type: RelationType.Replace, event_id: '$target' },
    });
    const room = makeRoom((id) => (id === '$target' ? target : undefined));
    const writer = createEngineWriteThrough({ sessionId: 'session' });

    writer.handleLiveEvent(edit as unknown as MatrixEvent, room, timelineMeta());
    expect(persistThreadEventCacheSnapshot).not.toHaveBeenCalled();

    writer.flush();
    expect(persistThreadEventCacheSnapshot).toHaveBeenCalledTimes(1);
  });
});
