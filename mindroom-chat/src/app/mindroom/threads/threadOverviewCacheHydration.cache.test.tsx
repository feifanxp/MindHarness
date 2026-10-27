import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { deleteCacheStoreDb, saveThreadEventsToCache } from './cacheStore';
import { useThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';

it('reads later overview batches even when the first threads have no cached replies', async () => {
  const sessionId = 'overview-batches';
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const room = new Room('!room:example.org', mx, '@alice:example.org');
  const roots = ['$empty-a', '$empty-b', '$saved-a', '$saved-b'];
  const summaries = new Map();
  const storeSummary = (rootId: string, info: unknown) => summaries.set(rootId, info);
  for (const rootId of roots.slice(2)) {
    await saveThreadEventsToCache(sessionId, room.roomId, rootId, [
      {
        event_id: `${rootId}-reply`,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: 1000,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'Saved reply',
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      },
      {
        event_id: `${rootId}-summary`,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: 2000,
        type: 'm.room.message',
        content: {
          msgtype: 'm.notice',
          body: 'Saved summary',
          'io.mindroom.thread_summary': true,
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      },
    ]);
  }
  const noThreads: [] = [];
  const noBodies = new Map();
  const noRecords = new Map();
  let previews: ReadonlyMap<string, string> = new Map();
  function Harness() {
    const cachedMetadata = useThreadOverviewCachedMetadata(room.roomId);
    previews = cachedMetadata.latestReplyPreviewMap;
    useThreadOverviewCacheHydration({
      overviewThreadRootIds: roots,
      overviewThreadMetadataCacheLimit: 2,
      room,
      roomThreadListThreads: noThreads,
      sessionId,
      mx,
      showCompactRoomView: true,
      compactThreadRootBodyMap: noBodies,
      compactThreadRecordMap: noRecords,
      threadRecordMap: noRecords,
      cachedMetadata,
      onStoreThreadSummary: storeSummary,
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(previews.get('$saved-b')).toBe('Saved reply');
      expect(summaries.get('$saved-b')).toEqual({
        summaryText: 'Saved summary',
        eventTs: 2000,
        eventId: '$saved-b-summary',
      });
    });
  } finally {
    await act(async () => renderer?.unmount());
    await deleteCacheStoreDb(sessionId);
  }
});
