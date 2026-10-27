import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createClient, MatrixEvent, Room, type Thread } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { createEngineWriteThrough } from '../engine/engineWriteThrough';
import {
  getMindroomThreadSummaryInfo,
  getThreadSummaryEventInfo,
  getThreadSummaryInfosFromEventSources,
} from '../messages/threadSummary';
import {
  loadCachedThreadSummaries,
  revokeRoomCacheStoreWrites,
  saveCachedThreadSummary,
  saveRoomEventsToCacheCommitted,
} from './cacheStore';
import {
  loadLatestCachedThreadEventsBatch,
  persistRoomChunkWithPreferLive,
  persistRoomEventCacheSnapshot,
  persistThreadEventCacheSnapshot,
  persistThreadEventCacheSnapshotCommitted,
} from './eventRepository';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import {
  clearThreadSummarySharedState,
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
  subscribeToThreadSummaryState,
} from './threadSummaryState';
import { useRoomThreadSummaryState } from './useRoomThreadSummaryState';

it('persists a live title queued by a hydration subscriber before the cache read settles', async () => {
  const sessionId = 'summary-read-settlement';
  const roomId = '!summary:test';
  await saveCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Cached title',
    generatedTs: 1000,
  });
  let queued = false;
  const unsubscribe = subscribeToThreadSummaryState(sessionId, roomId, () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      storeThreadSummaryInState(sessionId, roomId, '$other', {
        summaryText: 'Published after hydration',
        generatedTs: 2000,
      });
    });
  });
  try {
    await ensureThreadSummaryStateLoaded(sessionId, roomId);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$other')?.summaryText).toBe(
      'Published after hydration'
    );
    expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$other')?.summaryText).toBe(
      'Published after hydration'
    );
  } finally {
    unsubscribe();
    clearThreadSummarySharedState(sessionId);
  }
});

it.each([false, true])(
  'retries failed cache reads without losing disk titles or migration evidence (manual edit: %s)',
  async (manualEdit) => {
    const sessionId = `summary-failed-read-${manualEdit}`;
    const roomId = '!summary:test';
    const cached = { summaryText: 'Newer cached title', generatedTs: 9000 };
    await saveCachedThreadSummary(sessionId, roomId, '$root', cached);
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementationOnce(() => {
        throw new DOMException('Temporarily unavailable', 'InvalidStateError');
      });
    try {
      storeThreadSummaryInState(
        sessionId,
        roomId,
        '$root',
        manualEdit
          ? { ...cached, eventTs: 1000 }
          : { summaryText: 'Older live title', generatedTs: 1000, eventTs: 1000 },
        manualEdit
          ? {
              summaryText: 'Accepted human title',
              generatedTs: 1000,
              eventTs: 1200,
              isManual: true,
            }
          : undefined
      );
      await ensureThreadSummaryStateLoaded(sessionId, roomId);
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Newer cached title'
      );

      // A later live publication retries hydration without resending the first batch.
      storeThreadSummaryInState(sessionId, roomId, '$other', {
        summaryText: 'Another thread',
        generatedTs: 2000,
      });
      await ensureThreadSummaryStateLoaded(sessionId, roomId);
      const expected = manualEdit ? 'Accepted human title' : 'Newer cached title';
      expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
        expected
      );
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        expected
      );
    } finally {
      transaction.mockRestore();
      clearThreadSummarySharedState(sessionId);
    }
  }
);

it('retains a newer disk title when partial live history publishes before initial hydration', async () => {
  const sessionId = 'summary-partial-history';
  const roomId = '!summary:test';
  await saveCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Newer cached title',
    generatedTs: 9000,
  });
  storeThreadSummaryInState(sessionId, roomId, '$root', {
    summaryText: 'Older live title',
    generatedTs: 1000,
    eventTs: 1000,
  });
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
    'Newer cached title'
  );
  expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
    'Newer cached title'
  );
  clearThreadSummarySharedState(sessionId);
});

it('does not flush a pending publication after its session state is removed', async () => {
  const sessionId = 'summary-removed-session';
  const roomId = '!summary:test';
  await saveCachedThreadSummary(sessionId, roomId, '$root', {
    summaryText: 'Existing title',
    generatedTs: 9000,
  });
  storeThreadSummaryInState(sessionId, roomId, '$root', {
    summaryText: 'Removed session title',
    generatedTs: 10000,
    eventTs: 10000,
  });
  const pending = ensureThreadSummaryStateLoaded(sessionId, roomId);
  clearThreadSummarySharedState(sessionId);
  await pending;
  expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
    'Existing title'
  );
});

it.each([
  ['overview', false],
  ['thread', false],
  ['overview', true],
  ['thread', true],
] as const)(
  'persists legacy-cache enrichment from the %s (initial cache read pending: %s)',
  async (surface, pendingCacheRead) => {
    const sessionId = `summary-migration-${surface}-${pendingCacheRead}`;
    const roomId = '!summary-migration:test';
    const event = (
      id: string,
      summary: string,
      timestamp: number,
      generated: number,
      manual = false
    ) =>
      new MatrixEvent({
        event_id: id,
        type: 'm.room.message',
        origin_server_ts: timestamp,
        content: {
          msgtype: 'm.notice',
          body: summary,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          'io.mindroom.thread_summary': {
            version: 1,
            summary,
            generated_at: new Date(generated).toISOString(),
            ...(manual ? { model: 'manual' } : {}),
          },
        },
      });
    const automatic = event('$auto', 'Stale automatic', 1100, 9000);
    const manual = event('$manual', 'Accepted human title', 1200, 1000, true);
    await saveCachedThreadSummary(
      sessionId,
      roomId,
      '$root',
      getMindroomThreadSummaryInfo(automatic.getContent())!
    );
    if (!pendingCacheRead) await ensureThreadSummaryStateLoaded(sessionId, roomId);
    const threadEvents = [automatic, manual];
    const thread = { events: threadEvents, timeline: threadEvents } as Thread;
    const summaries = new Map([['$root', getMindroomThreadSummaryInfo(manual.getContent())!]]);
    const room = { getThread: () => thread };
    const Harness = () => {
      const { storeThreadSummary, summaryMap } = useRoomThreadSummaryState({ sessionId, roomId });
      useThreadSummaryPublishController({
        onStoreThreadSummary: storeThreadSummary,
        room,
        thread,
        threadEvents,
        threadId: surface === 'thread' ? '$root' : undefined,
        threadSummaryInfoMap: summaries,
      });
      return <span>{summaryMap.get('$root')?.summaryText}</span>;
    };
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness />);
    });
    await act(async () => ensureThreadSummaryStateLoaded(sessionId, roomId));
    try {
      expect(renderer.root.findByType('span').children).toEqual(['Accepted human title']);
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Accepted human title'
      );
    } finally {
      act(() => renderer.unmount());
    }
    clearThreadSummarySharedState(sessionId);
    await ensureThreadSummaryStateLoaded(sessionId, roomId);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
      'Accepted human title'
    );
  }
);

const summaryNotice = (roomId: string, id: string, summary: string, timestamp: number) =>
  new MatrixEvent({
    event_id: id,
    room_id: roomId,
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: {
      msgtype: 'm.notice',
      body: summary,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      'io.mindroom.thread_summary': {
        version: 1,
        summary,
        generated_at: new Date(timestamp).toISOString(),
      },
    },
  });

/** Cache and load `$leaked` as the thread's title, then redact it in a reader's room. */
const loadThenRedactSummary = async (sessionId: string, roomId: string) => {
  const leaked = summaryNotice(roomId, '$leaked', 'Leaked secret', 2000);
  await saveCachedThreadSummary(sessionId, roomId, '$root', getThreadSummaryEventInfo(leaked)!);
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
    'Leaked secret'
  );

  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  const room = new Room(roomId, mx, mx.getSafeUserId());
  const redaction = new MatrixEvent({
    event_id: '$redaction',
    room_id: roomId,
    type: 'm.room.redaction',
    origin_server_ts: 3000,
    redacts: '$leaked',
    content: { redacts: '$leaked' },
  });
  leaked.makeRedacted(redaction, room);
  return { leaked, redaction, room };
};

it('drops a redacted summary title from memory and disk so the thread falls back', async () => {
  const sessionId = 'summary-redacted';
  const roomId = '!summary-redacted:test';
  const older = summaryNotice(roomId, '$older', 'Older title', 1000);
  const { leaked, redaction, room } = await loadThenRedactSummary(sessionId, roomId);
  let persisted: Promise<boolean> | undefined;
  createEngineWriteThrough({
    sessionId,
    persist: (_room, events) => {
      persisted = saveRoomEventsToCacheCommitted(
        sessionId,
        roomId,
        events.map((event) => event.event)
      );
    },
  }).handleLiveEvent(redaction, room, {
    kind: 'redaction',
    roomId,
    liveEvent: true,
    toStartOfTimeline: false,
  });
  expect(await persisted).toBe(true);
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).has('$root')).toBe(false);
  expect((await loadCachedThreadSummaries(sessionId, roomId)).has('$root')).toBe(false);

  // Readers republish the thread's remaining summaries.
  storeThreadSummaryInState(
    sessionId,
    roomId,
    '$root',
    ...getThreadSummaryInfosFromEventSources([older, leaked])
  );
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
    'Older title'
  );
  clearThreadSummarySharedState(sessionId);
});

it.each(['thread history', 'room backfill'])(
  'drops a loaded summary title when %s brings an already redacted copy of its notice',
  async (seam) => {
    const sessionId = `summary-fetched-redacted-${seam}`;
    const roomId = '!summary-fetched-redacted:test';
    // The redaction itself fell in a sync gap; only fetched history shows the pruned notice.
    const { leaked, room } = await loadThenRedactSummary(sessionId, roomId);
    const { write } =
      seam === 'thread history'
        ? persistThreadEventCacheSnapshotCommitted({
            sessionId,
            room,
            threadId: '$root',
            events: [leaked],
          })
        : persistRoomEventCacheSnapshot({
            sessionId,
            room,
            events: [leaked],
            save: saveRoomEventsToCacheCommitted,
          });
    expect(await write).toBe(true);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).has('$root')).toBe(false);
    expect((await loadCachedThreadSummaries(sessionId, roomId)).has('$root')).toBe(false);
    clearThreadSummarySharedState(sessionId);
  }
);

const threadReply = (roomId: string, id: string, timestamp: number) =>
  new MatrixEvent({
    event_id: id,
    room_id: roomId,
    sender: '@agent:example',
    type: 'm.room.message',
    origin_server_ts: timestamp,
    content: {
      msgtype: 'm.text',
      body: id,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });

it.each(['live sync', 'fetched history'])(
  'keeps a summary notice that reaches the cache through %s without opening the thread',
  async (seam) => {
    const sessionId = `summary-from-cache-${seam}`;
    const roomId = '!summary-from-cache:test';
    const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
    const room = new Room(roomId, mx, mx.getSafeUserId());
    const notice = summaryNotice(roomId, '$summary', 'Cached title', 1000);
    // No room view is mounted.
    if (seam === 'live sync') {
      // As the sync engine's write-through persists a live thread event.
      await persistRoomChunkWithPreferLive({
        mx,
        sessionId,
        room,
        chunk: [notice.event],
        mappedEvents: [notice],
        roomTailLoaded: false,
        threadId: '$root',
      });
    } else {
      const replies = Array.from({ length: 40 }, (_, index) =>
        threadReply(roomId, `$reply-${index}`, 2000 + index)
      );
      await persistRoomChunkWithPreferLive({
        mx,
        sessionId,
        room,
        chunk: [notice, ...replies].map((event) => event.event),
      });
      // The overview reads only the newest 32 cached events of a thread.
      const tail = await loadLatestCachedThreadEventsBatch(sessionId, roomId, ['$root'], 32);
      expect(tail.get('$root')?.events.map((event) => event.event_id)).not.toContain('$summary');
    }

    await vi.waitFor(async () => {
      // The overview and the thread banner both read this state,
      expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
        'Cached title'
      );
      // and after a reload it comes from the summary store.
      expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
        'Cached title'
      );
    });
    clearThreadSummarySharedState(sessionId);
  }
);

it('records no summary once its cache lease is revoked', async () => {
  const sessionId = 'summary-revoked-lease';
  const roomId = '!summary-revoked-lease:test';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  const room = new Room(roomId, mx, mx.getSafeUserId());
  const { write } = persistThreadEventCacheSnapshotCommitted({
    sessionId,
    room,
    threadId: '$root',
    events: [summaryNotice(roomId, '$summary', 'Cleared title', 1000)],
  });
  expect(await write).toBe(true);
  // For example, the room's offline content is cleared before the title is published.
  revokeRoomCacheStoreWrites(sessionId, roomId);
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).has('$root')).toBe(false);
  clearThreadSummarySharedState(sessionId);
});

it('keeps a redacted summary out when a reconciler repair carries a stale copy of its notice', async () => {
  const sessionId = 'summary-stale-redacted-copy';
  const roomId = '!summary-stale-redacted-copy:test';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  const room = new Room(roomId, mx, mx.getSafeUserId());
  const older = summaryNotice(roomId, '$older', 'Older title', 1000);
  // Homeservers can briefly serve an unpruned copy next to its redaction.
  const stale = summaryNotice(roomId, '$leaked', 'Leaked secret', 2000);
  const redaction = new MatrixEvent({
    event_id: '$redaction',
    room_id: roomId,
    type: 'm.room.redaction',
    origin_server_ts: 3000,
    redacts: '$leaked',
    content: { redacts: '$leaked' },
  });
  const { write } = persistThreadEventCacheSnapshotCommitted({
    sessionId,
    room,
    threadId: '$root',
    events: [older, stale],
    relationSnapshotMode: 'authoritative',
    authoritativeRawEvents: [older, stale, redaction].map((event) => structuredClone(event.event)),
  });
  expect(await write).toBe(true);
  await vi.waitFor(async () => {
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
      'Older title'
    );
    expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
      'Older title'
    );
  });
  clearThreadSummarySharedState(sessionId);
});

it('keeps a redacted summary out when a later write brings a stale copy of its notice', async () => {
  const sessionId = 'summary-stale-copy-later';
  const roomId = '!summary-stale-copy-later:test';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  const room = new Room(roomId, mx, mx.getSafeUserId());
  const redaction = new MatrixEvent({
    event_id: '$redaction',
    room_id: roomId,
    type: 'm.room.redaction',
    origin_server_ts: 3000,
    redacts: '$leaked',
    content: { redacts: '$leaked' },
  });
  // The redaction is cached first, for example from live sync.
  const redactionWrite = persistThreadEventCacheSnapshotCommitted({
    sessionId,
    room,
    threadId: '$root',
    events: [redaction],
  });
  expect(await redactionWrite.write).toBe(true);
  // A later history fetch serves an unpruned copy of the redacted notice.
  const { write } = persistThreadEventCacheSnapshotCommitted({
    sessionId,
    room,
    threadId: '$root',
    events: [
      summaryNotice(roomId, '$older', 'Older title', 1000),
      summaryNotice(roomId, '$leaked', 'Leaked secret', 2000),
    ],
  });
  expect(await write).toBe(true);
  await vi.waitFor(async () => {
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
      'Older title'
    );
    expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
      'Older title'
    );
  });
  clearThreadSummarySharedState(sessionId);
});

it('does not publish an edited title whose write did not commit', async () => {
  const sessionId = 'summary-uncommitted-edit';
  const roomId = '!summary-uncommitted-edit:test';
  const mx = createClient({ baseUrl: 'https://matrix.example', userId: '@reader:example' });
  const room = new Room(roomId, mx, mx.getSafeUserId());
  persistThreadEventCacheSnapshot({
    sessionId,
    room,
    threadId: '$root',
    events: [summaryNotice(roomId, '$summary', 'First title', 1000)],
  });
  await vi.waitFor(async () => {
    expect((await loadCachedThreadSummaries(sessionId, roomId)).get('$root')?.summaryText).toBe(
      'First title'
    );
  });
  const edited = summaryNotice(roomId, '$summary', 'First title', 1000);
  edited.makeReplaced(
    new MatrixEvent({
      event_id: '$edit',
      room_id: roomId,
      type: 'm.room.message',
      origin_server_ts: 2000,
      content: {
        msgtype: 'm.notice',
        body: '* Edited title',
        'm.new_content': {
          msgtype: 'm.notice',
          body: 'Edited title',
          'io.mindroom.thread_summary': {
            version: 1,
            summary: 'Edited title',
            generated_at: new Date(2000).toISOString(),
          },
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$summary' },
      },
    })
  );
  // The cache still holds the unedited notice, so only the commit result can stop this title.
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
    throw new DOMException('Temporarily unavailable', 'InvalidStateError');
  });
  try {
    const { write } = persistThreadEventCacheSnapshot({
      sessionId,
      room,
      threadId: '$root',
      events: [edited],
    });
    expect(await write).toBe(false);
  } finally {
    transaction.mockRestore();
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(getThreadSummaryStateSnapshot(sessionId, roomId).get('$root')?.summaryText).toBe(
    'First title'
  );
  clearThreadSummarySharedState(sessionId);
});
