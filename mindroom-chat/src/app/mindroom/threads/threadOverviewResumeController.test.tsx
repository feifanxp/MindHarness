import React, { type MutableRefObject } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBackfillScheduler,
  MindroomSyncEngineProvider,
  type MindroomSyncEngine,
} from '../engine';
import { fetchAndPersistThreadContent } from './threadContentPrefetch';
import { loadRoomThreads } from './roomThreadList';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';

const resumeState = vi.hoisted(() => ({
  callback: undefined as
    | ((reason: 'focus' | 'online' | 'pageshow' | 'visibility') => void)
    | undefined,
}));

vi.mock('./usePageResume', () => ({
  usePageResume: (callback: (reason: 'focus' | 'online' | 'pageshow' | 'visibility') => void) => {
    resumeState.callback = callback;
  },
}));

vi.mock('./roomThreadList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./roomThreadList')>();
  return {
    ...original,
    loadRoomThreads: vi.fn(),
  };
});

vi.mock('./threadContentPrefetch', async (importOriginal) => {
  const original = await importOriginal<typeof import('./threadContentPrefetch')>();
  return {
    ...original,
    fetchAndPersistThreadContent: vi.fn(original.fetchAndPersistThreadContent),
  };
});

vi.mock('./threadOverviewRefreshTargets', () => ({
  resolveThreadOverviewRefreshTargets: () => ({
    overviewResumeRefreshIds: ['$thread-root', '$thread-root-2'],
    visibleThreadSummaryRefreshIds: ['$thread-root', '$thread-root-2'],
  }),
}));

vi.mock('./timelineDebug', () => ({
  logTimelineDebug: vi.fn(),
}));

const mockedFetchAndPersistThreadContent = vi.mocked(fetchAndPersistThreadContent);
const mockedLoadRoomThreads = vi.mocked(loadRoomThreads);

type HarnessProps = {
  compactViewRequested: boolean;
  mx: MatrixClient;
  onApplyThreadRelations: ReturnType<typeof vi.fn>;
  persistThreadEventCache: ReturnType<typeof vi.fn>;
  refreshCompactThreadList: ReturnType<typeof vi.fn>;
  room: Room;
  setOverviewRefreshCounter: ReturnType<typeof vi.fn>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
};

function Harness({
  compactViewRequested,
  mx,
  onApplyThreadRelations,
  persistThreadEventCache,
  refreshCompactThreadList,
  room,
  setOverviewRefreshCounter,
  threadId,
  threadIdRef,
}: HarnessProps) {
  useThreadOverviewResumeController({
    activeTimelineRange: { start: 0, end: 1 },
    alive: () => true,
    compactFilteredThreadRootIds: [],
    compactViewRequested,
    debugTraceId: 'resume-test',
    filteredThreadRootIds: ['$thread-root'],
    limit: 20,
    mx,
    onApplyThreadRelations,
    onStoreThreadSummary: vi.fn(),
    beginThreadCacheWrite: () => persistThreadEventCache,
    refreshCompactThreadList,
    room,
    sessionId: 'resume-session',
    setOverviewRefreshCounter,
    showCompactRoomView: false,
    threadFilteredEventEntries: [],
    threadId,
    threadIdRef,
    threadReplyCountMap: new Map(),
    threadResolutionMap: new Map(),
  });
  return null;
}

afterEach(() => {
  resumeState.callback = undefined;
  vi.clearAllMocks();
});

describe('useThreadOverviewResumeController', () => {
  it('abandons a pending general-overview list load when a thread opens', async () => {
    let finishListLoad: (() => void) | undefined;
    let listLoadSignal: AbortSignal | undefined;
    mockedLoadRoomThreads.mockImplementation((_room, _onProgress, signal) => {
      listLoadSignal = signal;
      return new Promise<void>((resolve) => {
        finishListLoad = resolve;
      });
    });

    const room = { roomId: '!room:example.org' } as Room;
    const mx = {} as MatrixClient;
    const engine = { scheduler: createBackfillScheduler() } as MindroomSyncEngine;
    const threadIdRef = { current: undefined } as MutableRefObject<string | undefined>;
    const onApplyThreadRelations = vi.fn();
    const persistThreadEventCache = vi.fn();
    const refreshCompactThreadList = vi.fn(async () => undefined);
    const setOverviewRefreshCounter = vi.fn();
    let renderer!: ReactTestRenderer;
    const render = (threadId: string | undefined) => (
      <MindroomSyncEngineProvider engine={engine}>
        <Harness
          compactViewRequested={false}
          mx={mx}
          onApplyThreadRelations={onApplyThreadRelations}
          persistThreadEventCache={persistThreadEventCache}
          refreshCompactThreadList={refreshCompactThreadList}
          room={room}
          setOverviewRefreshCounter={setOverviewRefreshCounter}
          threadId={threadId}
          threadIdRef={threadIdRef}
        />
      </MindroomSyncEngineProvider>
    );

    await act(async () => {
      renderer = create(render(undefined));
    });

    await act(async () => {
      resumeState.callback?.('focus');
      await Promise.resolve();
    });
    expect(mockedLoadRoomThreads).toHaveBeenCalledOnce();
    expect(listLoadSignal).toBeDefined();
    expect(listLoadSignal?.aborted).toBe(false);

    threadIdRef.current = '$thread-root';
    await act(async () => {
      renderer.update(render('$thread-root'));
    });
    expect(listLoadSignal?.aborted).toBe(true);

    await act(async () => {
      finishListLoad?.();
      await Promise.resolve();
    });

    expect(mockedFetchAndPersistThreadContent).not.toHaveBeenCalled();
    expect(onApplyThreadRelations).not.toHaveBeenCalled();
    expect(setOverviewRefreshCounter).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it.each([
    { initialCompact: false, nextCompact: true, transition: 'general to compact' },
    { initialCompact: true, nextCompact: false, transition: 'compact to general' },
  ])(
    'releases only its relation refresh ownership when switching $transition',
    async ({ initialCompact, nextCompact }) => {
      mockedLoadRoomThreads.mockResolvedValue(undefined);
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
      const rawReply: Partial<IEvent> = {
        content: {
          body: 'reply',
          'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
        },
        event_id: '$reply',
        origin_server_ts: 2_000,
        room_id: roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
      };
      let finishRelationRequest: (() => void) | undefined;
      const relationResponse = new Promise<{
        chunk: Partial<IEvent>[];
        next_batch: undefined;
      }>((resolve) => {
        finishRelationRequest = () => resolve({ chunk: [rawReply], next_batch: undefined });
      });
      const room = {
        findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
        getLastActiveTimestamp: () => 0,
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
      const scheduler = createBackfillScheduler({ mx });
      const engine = { scheduler } as MindroomSyncEngine;
      const threadIdRef = { current: undefined } as MutableRefObject<string | undefined>;
      const overviewApply = vi.fn();
      const overviewPersist = vi.fn();
      const refreshCompactThreadList = vi.fn(async () => undefined);
      const setOverviewRefreshCounter = vi.fn();
      let renderer!: ReactTestRenderer;
      const render = (compactViewRequested: boolean) => (
        <MindroomSyncEngineProvider engine={engine}>
          <Harness
            compactViewRequested={compactViewRequested}
            mx={mx}
            onApplyThreadRelations={overviewApply}
            persistThreadEventCache={overviewPersist}
            refreshCompactThreadList={refreshCompactThreadList}
            room={room}
            setOverviewRefreshCounter={setOverviewRefreshCounter}
            threadId={undefined}
            threadIdRef={threadIdRef}
          />
        </MindroomSyncEngineProvider>
      );

      await act(async () => {
        renderer = create(render(initialCompact));
      });
      await act(async () => {
        resumeState.callback?.('focus');
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(fetchRelations).toHaveBeenCalledOnce());

      const survivorApply = vi.fn();
      const survivorPersist = vi.fn();
      const survivorLoad = fetchAndPersistThreadContent({
        mx,
        scheduler,
        room,
        threadId,
        priority: 3,
        shouldApply: () => true,
        beginThreadCacheWrite: () => survivorPersist,
        onApplyThreadRelations: survivorApply,
      });
      await Promise.resolve();
      expect(fetchRelations).toHaveBeenCalledOnce();

      await act(async () => {
        renderer.update(render(nextCompact));
      });

      await act(async () => {
        finishRelationRequest?.();
        await survivorLoad;
      });

      expect(fetchRelations).toHaveBeenCalledOnce();
      expect(mockedFetchAndPersistThreadContent).toHaveBeenCalledTimes(2);
      expect(survivorApply).toHaveBeenCalledOnce();
      expect(survivorPersist).toHaveBeenCalledOnce();
      expect(overviewApply).not.toHaveBeenCalled();
      expect(overviewPersist).not.toHaveBeenCalled();
      expect(setOverviewRefreshCounter).not.toHaveBeenCalled();

      renderer.unmount();
    }
  );
});
