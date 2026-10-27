import { MatrixEvent, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from '../engine';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { fetchAndPersistThreadContent } from './threadContentPrefetch';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';

vi.mock('./threadOpenSeedCache', () => ({
  saveThreadOpenSeedSnapshot: vi.fn(),
}));

describe('fetchAndPersistThreadContent', () => {
  it('discards every write from a relation snapshot when the summary changes in flight', async () => {
    const roomId = '!room:example.org';
    const threadId = '$thread-root';
    const rootEvent = new MatrixEvent({
      content: { body: 'root', msgtype: 'm.text' },
      event_id: threadId,
      origin_server_ts: 1_000,
      room_id: roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    const rawStaleSummary: Partial<IEvent> = {
      content: {
        body: 'stale future summary',
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': {
          generated_at: '2099-01-01T00:00:00.000Z',
          message_count: 1,
          summary: 'stale future summary',
          version: 1,
        },
        'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
      },
      event_id: '$stale-summary',
      origin_server_ts: 2_000,
      room_id: roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
    };
    let finishRelationRequest: (() => void) | undefined;
    const relationResponse = new Promise<{ chunk: Partial<IEvent>[]; next_batch: undefined }>(
      (resolve) => {
        finishRelationRequest = () => resolve({ chunk: [rawStaleSummary], next_batch: undefined });
      }
    );
    const room = {
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
      getThread: () => null,
      roomId,
    } as unknown as Room;
    const fetchRelations = vi.fn(() => relationResponse);
    const mx = {
      fetchRelations,
      getEventMapper: () => (raw: Partial<IEvent>) =>
        new MatrixEvent(raw as ConstructorParameters<typeof MatrixEvent>[0]),
      getRoom: () => room,
    } as unknown as MatrixClient;
    const persistThreadEventCache = vi.fn();
    const onApplyThreadRelations = vi.fn();
    const onStoreThreadSummary = vi.fn();
    let currentSummary: MindroomThreadSummaryInfo | undefined;

    const load = fetchAndPersistThreadContent({
      mx,
      scheduler: createBackfillScheduler({ mx }),
      room,
      threadId,
      priority: 2,
      getCurrentThreadSummary: () => currentSummary,
      beginThreadCacheWrite: () => persistThreadEventCache,
      onApplyThreadRelations,
      onStoreThreadSummary,
    });
    await vi.waitFor(() => expect(fetchRelations).toHaveBeenCalledOnce());

    currentSummary = {
      generatedTs: 3_000,
      isManual: true,
      messageCount: 1,
      summaryText: 'accepted manual title',
    };
    finishRelationRequest?.();

    await expect(load).resolves.toBeUndefined();
    expect(saveThreadOpenSeedSnapshot).not.toHaveBeenCalled();
    expect(onApplyThreadRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
    expect(onStoreThreadSummary).not.toHaveBeenCalled();

    const rawNewerSummary: Partial<IEvent> = {
      ...rawStaleSummary,
      content: {
        ...rawStaleSummary.content,
        body: 'newer agent summary',
        'io.mindroom.thread_summary': {
          generated_at: '2101-01-01T00:00:00.000Z',
          message_count: 2,
          summary: 'newer agent summary',
          version: 1,
        },
      },
      event_id: '$newer-summary',
      origin_server_ts: 4_000,
    };
    fetchRelations.mockResolvedValueOnce({ chunk: [rawNewerSummary], next_batch: undefined });

    await expect(
      fetchAndPersistThreadContent({
        mx,
        scheduler: createBackfillScheduler({ mx }),
        room,
        threadId,
        priority: 2,
        getCurrentThreadSummary: () => currentSummary,
        beginThreadCacheWrite: () => persistThreadEventCache,
        onApplyThreadRelations,
        onStoreThreadSummary,
      })
    ).resolves.toMatchObject({ fetchedCount: 1 });
    expect(saveThreadOpenSeedSnapshot).toHaveBeenCalledOnce();
    expect(onApplyThreadRelations).toHaveBeenCalledOnce();
    expect(persistThreadEventCache).toHaveBeenCalledOnce();
    expect(onStoreThreadSummary).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({ summaryText: 'newer agent summary' })
    );
  });
});
