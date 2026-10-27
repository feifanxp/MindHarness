import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { loadCachedThreadSummaries, saveCachedThreadSummary } from './cacheStore';
import {
  buildPreferredThreadSummaryMap,
  selectThreadSummaryUpdate,
} from './threadSummarySelection';

type ThreadSummaryListener = () => void;

export type ThreadSummaryWriter = (
  threadRootId: string,
  ...infos: Array<MindroomThreadSummaryInfo | undefined>
) => void;

type RoomThreadSummaryState = {
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  listeners: Set<ThreadSummaryListener>;
  loadPromise?: Promise<void>;
  hasLoaded?: boolean;
  incomingDuringLoad?: Map<string, Array<MindroomThreadSummaryInfo | undefined>>;
};

const EMPTY_SUMMARY_MAP = new Map<string, MindroomThreadSummaryInfo>();
const roomThreadSummaryStates = new Map<string, RoomThreadSummaryState>();

const getStateKey = (sessionId: string, roomId: string): string => `${sessionId}|${roomId}`;

const getOrCreateState = (sessionId: string, roomId: string): RoomThreadSummaryState => {
  const stateKey = getStateKey(sessionId, roomId);
  const existingState = roomThreadSummaryStates.get(stateKey);
  if (existingState) return existingState;

  const nextState: RoomThreadSummaryState = {
    summaryMap: new Map(),
    listeners: new Set(),
  };
  roomThreadSummaryStates.set(stateKey, nextState);
  return nextState;
};

const notifyStateListeners = (state: RoomThreadSummaryState) => {
  state.listeners.forEach((listener) => listener());
};

const areSummaryMapsEqual = (
  left: Map<string, MindroomThreadSummaryInfo>,
  right: Map<string, MindroomThreadSummaryInfo>
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;

  for (const [threadRootId, leftInfo] of left) {
    const rightInfo = right.get(threadRootId);
    if (!rightInfo) return false;
    if (
      leftInfo.summaryText !== rightInfo.summaryText ||
      leftInfo.generatedTs !== rightInfo.generatedTs ||
      leftInfo.eventTs !== rightInfo.eventTs ||
      leftInfo.messageCount !== rightInfo.messageCount ||
      leftInfo.isManual !== rightInfo.isManual
    ) {
      return false;
    }
  }

  return true;
};

export const clearThreadSummarySharedState = (sessionId?: string) => {
  if (!sessionId) {
    roomThreadSummaryStates.clear();
    return;
  }

  const prefix = `${sessionId}|`;
  roomThreadSummaryStates.forEach((_state, stateKey) => {
    if (stateKey.startsWith(prefix)) roomThreadSummaryStates.delete(stateKey);
  });
};

export const subscribeToThreadSummaryState = (
  sessionId: string | undefined,
  roomId: string | undefined,
  listener: ThreadSummaryListener
) => {
  if (!sessionId || !roomId) return () => undefined;

  const state = getOrCreateState(sessionId, roomId);
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
};

export const getThreadSummaryStateSnapshot = (
  sessionId: string | undefined,
  roomId: string | undefined
): Map<string, MindroomThreadSummaryInfo> => {
  if (!sessionId || !roomId) return EMPTY_SUMMARY_MAP;
  return getOrCreateState(sessionId, roomId).summaryMap;
};

export const ensureThreadSummaryStateLoaded = async (sessionId: string, roomId: string) => {
  const state = getOrCreateState(sessionId, roomId);
  if (state.loadPromise) return state.loadPromise;
  // Preserve the full evidence while a disk read is pending. Reducing live
  // batches before this merge could resurrect a legacy record with a skewed
  // metadata clock after its newer replacement has already been published.
  const incomingDuringLoad =
    state.incomingDuringLoad ?? new Map<string, Array<MindroomThreadSummaryInfo | undefined>>();
  state.incomingDuringLoad = incomingDuringLoad;
  state.hasLoaded = false;

  state.loadPromise = loadCachedThreadSummaries(sessionId, roomId)
    .then((cachedSummaryMap) => {
      if (roomThreadSummaryStates.get(getStateKey(sessionId, roomId)) !== state) return;
      const nextSummaryMap = buildPreferredThreadSummaryMap(
        cachedSummaryMap,
        state.summaryMap,
        incomingDuringLoad
      );
      if (!areSummaryMapsEqual(state.summaryMap, nextSummaryMap)) {
        state.summaryMap = nextSummaryMap;
        notifyStateListeners(state);
      }
      state.hasLoaded = true;
    })
    // A failed read must retain the evidence and leave disk untouched until retry.
    .catch(() => {})
    .finally(() => {
      state.loadPromise = undefined;
      if (!state.hasLoaded) return;
      state.incomingDuringLoad = undefined;
      if (roomThreadSummaryStates.get(getStateKey(sessionId, roomId)) !== state) return;
      incomingDuringLoad.forEach((_candidates, threadRootId) => {
        const info = state.summaryMap.get(threadRootId);
        if (info) saveCachedThreadSummary(sessionId, roomId, threadRootId, info).catch(() => {});
      });
    });

  return state.loadPromise;
};

export const storeThreadSummaryInState = (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  ...infos: Array<MindroomThreadSummaryInfo | undefined>
): boolean => {
  if (!threadRootId) return false;

  const state = getOrCreateState(sessionId, roomId);
  // Start the initial read before a live publication can replace an unknown
  // disk title. Pending writes flush only after that read and its evidence merge.
  if (!state.hasLoaded && !state.loadPromise)
    void ensureThreadSummaryStateLoaded(sessionId, roomId);
  if (state.incomingDuringLoad) {
    const candidates = state.incomingDuringLoad.get(threadRootId) ?? [];
    candidates.push(...infos);
    state.incomingDuringLoad.set(threadRootId, candidates);
  }
  const currentInfo = state.summaryMap.get(threadRootId);
  const info = selectThreadSummaryUpdate(currentInfo, ...infos);
  if (!info) return false;

  const nextSummaryMap = new Map(state.summaryMap);
  nextSummaryMap.set(threadRootId, info);
  state.summaryMap = nextSummaryMap;
  notifyStateListeners(state);

  if (!state.loadPromise)
    saveCachedThreadSummary(sessionId, roomId, threadRootId, info).catch(() => {});
  return true;
};

/**
 * Drop titles taken from redacted summary notices, so readers fall back to
 * the thread's remaining summaries. The redaction's cache scrub clears disk.
 */
export const forgetRedactedThreadSummaries = (
  sessionId: string,
  roomId: string,
  redactedEventIds: ReadonlySet<string>
) => {
  const state = roomThreadSummaryStates.get(getStateKey(sessionId, roomId));
  if (!state || redactedEventIds.size === 0) return;
  const nextSummaryMap = new Map(
    [...state.summaryMap].filter(([, info]) => !info.eventId || !redactedEventIds.has(info.eventId))
  );
  if (nextSummaryMap.size === state.summaryMap.size) return;
  state.summaryMap = nextSummaryMap;
  notifyStateListeners(state);
};

type UseThreadSummaryStateOptions = {
  roomId: string;
  sessionId?: string;
};

export const useThreadSummaryStateMap = ({
  roomId,
  sessionId,
}: UseThreadSummaryStateOptions): Map<string, MindroomThreadSummaryInfo> => {
  const subscribe = useCallback(
    (listener: ThreadSummaryListener) => subscribeToThreadSummaryState(sessionId, roomId, listener),
    [roomId, sessionId]
  );
  const getSnapshot = useCallback(
    () => getThreadSummaryStateSnapshot(sessionId, roomId),
    [roomId, sessionId]
  );

  const summaryMap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!sessionId) return;
    ensureThreadSummaryStateLoaded(sessionId, roomId).catch(() => {});
  }, [roomId, sessionId]);

  return summaryMap;
};
