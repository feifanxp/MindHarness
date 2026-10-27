import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { PersistThreadEventCache } from '../../engine/enginePersistFacade';
import type { ScheduleReconcileFn } from '../threadOpenCacheFirst';

export type ThreadRoute = Readonly<{ roomId: string; threadId?: string; eventId?: string }>;
export type ThreadOpenLease = Readonly<{ roomId: string; threadId: string; generation: number }>;
export type PendingThreadTarget = Readonly<{
  requestId: number;
  threadId: string;
  eventId: string;
  highlight: boolean;
  attempts: number;
}>;
export type ThreadSessionSnapshot = Readonly<{
  route: ThreadRoute;
  open: Readonly<{
    loadError: boolean;
    initialCacheHydrated: boolean;
    sdkReady: boolean;
    latestPending: boolean;
    editResetEpoch: number;
  }>;
  history: Readonly<{ hasMoreCachedBack: boolean; tailLoaded: boolean }>;
  timelineRevision: number;
  targetRevision: number;
}>;
export type ThreadTargetCommands = {
  getPending(): PendingThreadTarget | undefined;
  queue(input: {
    threadId: string;
    eventId: string;
    highlight: boolean;
    onScroll?: (success: boolean) => void;
  }): void;
  complete(requestId: number, success: boolean): void;
  discard(requestId: number): void;
  advanceAttempt(requestId: number): void;
  wakeRetry(requestId: number): void;
};
export type ThreadRenderPort = {
  reset(threadId?: string): void;
  append(threadId: string, events: MatrixEvent[]): void;
  invalidateTimeline(): void;
};
export type ThreadOpenViewportPort = {
  resetForOpen(): void;
  resetAfterLeave(): void;
  requestLatestPin(): void;
};
export type ThreadSeedOpenPort = {
  waitForExistingOrQueued(
    threadId: string,
    options: { traceId?: string }
  ): Promise<void> | undefined;
};
export type ThreadOpenRuntime = {
  room: Room;
  mx: MatrixClient;
  sessionId: string;
  beginCacheWrite: () => PersistThreadEventCache;
  reconcile: ScheduleReconcileFn;
  seed: ThreadSeedOpenPort;
  render: ThreadRenderPort;
  viewport: ThreadOpenViewportPort;
  debugTraceId?: string;
  onThreadLoadError?: (threadId: string) => void;
};
export type ThreadPageCommit =
  | { kind: 'back-cache'; events: MatrixEvent[]; hasMoreCachedBack: boolean }
  | { kind: 'back-network'; hasMoreCachedBack: boolean }
  | { kind: 'front-network'; tailLoaded: boolean };
export type ThreadSessionCommands = {
  startOpen(runtime: ThreadOpenRuntime): () => void;
  leaveThread(runtime: Pick<ThreadOpenRuntime, 'render' | 'viewport'>): void;
  refreshLatest(
    threadId: string,
    runtime: ThreadOpenRuntime,
    options?: { allowWhenThreadClosed?: boolean }
  ): Promise<boolean>;
  beginManualHistoryRead(): void;
  commitPage(lease: ThreadOpenLease, page: ThreadPageCommit): boolean;
  markBackwardExhausted(lease: ThreadOpenLease): void;
  observeLiveTail(threadId: string): void;
  notifyEventsChanged(): void;
  readEditResetEpoch(): number;
  captureLease(): ThreadOpenLease | undefined;
  isCurrent(lease: ThreadOpenLease): boolean;
};
export type ThreadSession = {
  snapshot: ThreadSessionSnapshot;
  commands: ThreadSessionCommands;
  targets: ThreadTargetCommands;
};

export type ThreadPaginationRequest = Readonly<{
  lease: ThreadOpenLease;
  direction: 'backward' | 'forward';
  requestId: number;
}>;
export type ThreadPaginationSnapshot = Readonly<{
  backward: 'idle' | 'pending';
  forward: 'idle' | 'pending';
}>;
export type ThreadPrependViewportPort = {
  begin(request: ThreadPaginationRequest): boolean;
  waitForQuiescence(request: ThreadPaginationRequest): Promise<void>;
  finish(request: ThreadPaginationRequest): void;
};
export type ThreadPagination = {
  snapshot: ThreadPaginationSnapshot;
  paginateBack(): Promise<void>;
  paginateFront(): Promise<void>;
  isPending(direction: 'backward' | 'forward'): boolean;
  reset(): void;
};
