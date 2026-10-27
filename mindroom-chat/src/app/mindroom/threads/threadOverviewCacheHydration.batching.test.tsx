import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLatestCachedThreadEventsBatch, type CachedThreadEventPage } from './eventRepository';
import { useThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';
import type { ThreadRecord } from './types';

vi.mock('./eventRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./eventRepository')>()),
  loadLatestCachedThreadEventsBatch: vi.fn(),
}));

const loadBatch = vi.mocked(loadLatestCachedThreadEventsBatch);
const pages = (ids: readonly string[]) =>
  new Map<string, CachedThreadEventPage>(
    ids.map((id) => [id, { events: [], hasMoreBefore: false, expectedReplyCount: 1 }])
  );

const pagesWithReply = (ids: readonly string[], summary = false) => {
  const result = pages(ids);
  const page = result.get('$root-2');
  if (page)
    page.events.push({
      event_id: summary ? '$cached-summary' : '$cached-reply',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@agent:example.org',
      type: 'm.room.message',
      content: {
        body: summary ? 'Cached summary' : 'Cached reply',
        msgtype: summary ? 'm.notice' : 'm.text',
        ...(summary ? { 'io.mindroom.thread_summary': true } : {}),
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root-2' },
      },
    });
  return result;
};

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  loadBatch.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mount = async () => {
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@self:example.org' });
  const room = new Room('!room:example.org', mx, '@self:example.org');
  const roots = Array.from({ length: 8 }, (_, index) => `$root-${index}`);
  const bodies = new Map(roots.map((id) => [id, 'Complete live preview']));
  const noThreads: [] = [];
  const noRecords = new Map();
  const storeSummary = vi.fn();
  const publishedSizes: number[] = [];
  let replyPreviews: ReadonlyMap<string, string> = new Map();
  function Harness({
    records = noRecords,
    activeRoom = room,
    sessionId = 'batching',
  }: {
    records?: Map<string, ThreadRecord>;
    activeRoom?: Room;
    sessionId?: string;
  }) {
    const cachedMetadata = useThreadOverviewCachedMetadata(activeRoom.roomId);
    replyPreviews = cachedMetadata.latestReplyPreviewMap;
    const size = cachedMetadata.coverageMap.size;
    if (publishedSizes.at(-1) !== size) publishedSizes.push(size);
    useThreadOverviewCacheHydration({
      overviewThreadRootIds: roots,
      overviewThreadMetadataCacheLimit: 2,
      room: activeRoom,
      roomThreadListThreads: noThreads,
      sessionId,
      mx,
      showCompactRoomView: true,
      compactThreadRootBodyMap: bodies,
      compactThreadRecordMap: records,
      threadRecordMap: records,
      cachedMetadata,
      onStoreThreadSummary: storeSummary,
    });
    return null;
  }
  await act(async () => {
    renderer = create(<Harness />);
  });
  return {
    publishedSizes,
    roots,
    storeSummary,
    getReplyPreviews: () => replyPreviews,
    refresh: async (
      records = new Map<string, ThreadRecord>(),
      scope: { sessionId?: string; roomId?: string } = {}
    ) => {
      const activeRoom = scope.roomId ? new Room(scope.roomId, mx, '@self:example.org') : room;
      await act(async () =>
        renderer?.update(
          <Harness records={records} activeRoom={activeRoom} sessionId={scope.sessionId} />
        )
      );
    },
  };
};

describe('overview cache publication', () => {
  it('shows the first batch promptly and combines subsequent fast reads', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    loadBatch.mockImplementation(async (_session, _room, ids) => pages(ids));
    const { publishedSizes, roots } = await mount();
    expect(publishedSizes).toEqual([0, 2, 8]);
    expect(loadBatch.mock.calls.map((call) => call[2])).toEqual([
      roots.slice(0, 2),
      roots.slice(2, 4),
      roots.slice(4, 6),
      roots.slice(6, 8),
    ]);
  });

  it('publishes progress during slower cache reads', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-2') now += 300;
      return pages(ids);
    });
    const { publishedSizes } = await mount();
    expect(publishedSizes).toEqual([0, 2, 4, 8]);
  });

  it('does not publish buffered updates after the overview closes', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    let finishRead!: (value: Map<string, CachedThreadEventPage>) => void;
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-4')
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      return pagesWithReply(ids, true);
    });
    const { publishedSizes, storeSummary } = await mount();
    expect(publishedSizes).toEqual([0, 2]);
    await act(async () => renderer?.unmount());
    await act(async () => finishRead(pages(['$root-4', '$root-5'])));
    expect(publishedSizes).toEqual([0, 2]);
    expect(storeSummary).not.toHaveBeenCalled();
    expect(loadBatch).toHaveBeenCalledTimes(3);
  });

  it('publishes completed batches even when the next cache read never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-4') return new Promise(() => {});
      return pages(ids);
    });
    const { publishedSizes } = await mount();
    expect(publishedSizes).toEqual([0, 2]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(publishedSizes).toEqual([0, 2, 4]);
    expect(loadBatch.mock.calls.filter((call) => call[2][0] === '$root-4')).toHaveLength(1);
  });

  it('keeps completed batches when a later read fails and retries remaining roots', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    let failed = false;
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-4' && !failed) {
        failed = true;
        throw new Error('cache unavailable');
      }
      return pages(ids);
    });
    const { publishedSizes } = await mount();
    expect(publishedSizes).toEqual([0, 2, 4, 8]);
    expect(loadBatch.mock.calls.filter((call) => call[2][0] === '$root-4')).toHaveLength(2);
  });

  it('keeps making progress when live record updates interrupt buffered publication', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-4') return new Promise(() => {});
      return pagesWithReply(ids);
    });
    const { publishedSizes, refresh, getReplyPreviews } = await mount();
    expect(publishedSizes).toEqual([0, 2]);
    const freshRecord = {
      threadRootId: '$root-2',
      status: { lastActivityTs: 2000, replyCount: 1 },
      presentation: { latestReplyPreviewText: 'Newer live reply', messageCount: 1 },
    } as ThreadRecord;
    await refresh(new Map([['$root-2', freshRecord]]));
    expect(publishedSizes).toEqual([0, 2, 4]);
    expect(getReplyPreviews().has('$root-2')).toBe(false);
    await refresh();
    await refresh();
    expect(loadBatch.mock.calls.filter((call) => call[2][0] === '$root-2')).toHaveLength(2);
    expect(loadBatch.mock.calls.filter((call) => call[2][0] === '$root-4')).toHaveLength(1);
  });

  it('derives shared pending results against the latest live record', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    let finishRead!: (value: Map<string, CachedThreadEventPage>) => void;
    loadBatch.mockImplementation(async (_session, _room, ids) => {
      if (ids[0] === '$root-2')
        return new Promise((resolve) => {
          finishRead ??= resolve;
        });
      return pages(ids);
    });
    const { publishedSizes, refresh, getReplyPreviews } = await mount();
    const freshRecord = {
      threadRootId: '$root-2',
      status: { lastActivityTs: 2000, replyCount: 1 },
      presentation: { latestReplyPreviewText: 'Newer live reply', messageCount: 1 },
    } as ThreadRecord;
    await refresh(new Map([['$root-2', freshRecord]]));
    await act(async () => finishRead(pagesWithReply(['$root-2', '$root-3'])));
    expect(publishedSizes).toEqual([0, 2, 8]);
    expect(getReplyPreviews().has('$root-2')).toBe(false);
    expect(loadBatch.mock.calls.filter((call) => call[2][0] === '$root-2')).toHaveLength(1);
  });

  it('reuses reordered pending batches while isolating sessions and rooms', async () => {
    loadBatch.mockImplementation(() => new Promise(() => {}));
    const { roots, refresh } = await mount();
    roots.splice(0, 2, '$root-1', '$root-0');
    await refresh();
    expect(loadBatch).toHaveBeenCalledTimes(1);
    await refresh(new Map(), { sessionId: 'another-session' });
    await refresh(new Map(), { sessionId: 'another-session', roomId: '!other:example.org' });
    expect(loadBatch.mock.calls.map(([sessionId, roomId]) => [sessionId, roomId])).toEqual([
      ['batching', '!room:example.org'],
      ['another-session', '!room:example.org'],
      ['another-session', '!other:example.org'],
    ]);
  });
});
