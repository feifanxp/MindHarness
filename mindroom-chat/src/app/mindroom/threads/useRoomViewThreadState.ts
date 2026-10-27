import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { createSessionId } from '../../state/sessions';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { isIOSStandaloneWebApp } from '../native/nativeSso';
import { useEdgeSwipeBack } from '../native/useEdgeSwipeBack';
import { useEdgeSwipeForward } from '../native/useEdgeSwipeForward';
import { bumpRecentThread } from '../recent-threads/recentThreads';
import { resolveRecentThreadSummaryText } from '../recent-threads/recentThreadSummaryUtils';
import { lastExitedThreadAtom } from './lastExitedThread';
import {
  getRoomThreadExitTargetFromHistoryState,
  withRoomThreadExitTargetState,
} from './roomNavigateState';
import {
  addTagFilter,
  applyPreset,
  cycleSortMode,
  cycleTagFilter,
  type FilterPreset,
  normalizeThreadSearchText,
  removeTagFilter,
  resetThreadFilterState,
  simplifyAgentlessSimpleThreadFilterState,
  simplifyAgentlessThreadFilterState,
  simplifyThreadFilterState,
  type ThreadFilterKey,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  updateThreadFilterKey,
} from './roomThreadOverviewModel';
import { roomThreadFilterAtomFamily } from './roomThreadFilterState';
import type { RoomViewMode } from './roomViewMode';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';
import { useRoomThreadSummaryState } from './threadSummaryStore';
import { useThreadRootEvent } from './useThreadRootEvent';
import { isConfirmedMatrixEventId, isLocalEchoEventId } from './threadRouteUtils';
import { useRoomViewMode } from './useRoomViewMode';

type UseRoomViewThreadStateOptions = {
  eventId?: string;
  hasMindroomAgents?: boolean;
  room: Room;
  threadId?: string;
};

export type RoomViewThreadState = {
  effectiveThreadId?: string;
  handleAddTag: (tag: string) => void;
  handleApplyPreset: (preset: FilterPreset) => void;
  handleCycleTag: (tag: string) => void;
  handleExitThread: () => void;
  handleThreadRootDeleted: () => void;
  handleRemoveTag: (tag: string) => void;
  handleReset: () => void;
  handleSearchQueryChange: (query: string) => void;
  handleSortDirectionChange: () => void;
  handleToggle: (key: ThreadFilterKey) => void;
  handleToggleThreadSortFreeze: () => void;
  handleToggleUnresolvedOnly: () => void;
  handleRoomMessageSent: (eventId: string) => boolean;
  handleViewModeChange: (mode: RoomViewMode) => void;
  setThreadSortFreezeState: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  storeThreadSummary: ReturnType<typeof useRoomThreadSummaryState>['storeThreadSummary'];
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  threadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSummaryInfo?: MindroomThreadSummaryInfo;
  viewMode: RoomViewMode;
};

export const useRoomViewThreadState = ({
  eventId,
  hasMindroomAgents = true,
  room,
  threadId,
}: UseRoomViewThreadStateOptions): RoomViewThreadState => {
  const { t } = useTranslation();
  const { roomId } = room;
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), userId), [mx, userId]);
  const { navigatePath, navigateRoom, navigateRoomFocusEvent, navigateRoomThread } =
    useRoomNavigate();

  const { setViewMode, viewMode: effectiveViewMode } = useRoomViewMode(roomId);
  const threadFilterAtom = useMemo(
    () => roomThreadFilterAtomFamily(userId, roomId),
    [roomId, userId]
  );
  const [threadFilterState, setThreadFilterState] = useAtom(threadFilterAtom);
  // Project stored filters onto the controls that are currently visible.
  // Persisted advanced filters must not keep hiding threads with no visible
  // cause, but remain stored so they can be restored when those controls
  // become available again.
  const simpleMode = useSimpleMode();
  const effectiveThreadFilterState = useMemo(() => {
    if (simpleMode) {
      return hasMindroomAgents
        ? simplifyThreadFilterState(threadFilterState)
        : simplifyAgentlessSimpleThreadFilterState(threadFilterState);
    }
    return hasMindroomAgents
      ? threadFilterState
      : simplifyAgentlessThreadFilterState(threadFilterState);
  }, [hasMindroomAgents, simpleMode, threadFilterState]);
  const lastExitedThread = useAtomValue(lastExitedThreadAtom);
  const setLastExitedThread = useSetAtom(lastExitedThreadAtom);
  const [threadSortFreezeState, setThreadSortFreezeState] = useState<ThreadSortFreezeState | null>(
    null
  );
  const effectiveThreadSortFreezeState =
    hasMindroomAgents && !simpleMode ? threadSortFreezeState : null;
  const { summaryMap, storeThreadSummary } = useRoomThreadSummaryState({
    roomId,
    sessionId,
  });
  const threadRootId = useThreadRootEvent(room, threadId);
  const effectiveThreadId = threadRootId ?? threadId;
  const resolvedThreadRootEvent = effectiveThreadId
    ? room.getThread(effectiveThreadId)?.rootEvent ?? room.findEventById(effectiveThreadId)
    : undefined;
  const threadSummaryInfo = effectiveThreadId ? summaryMap.get(effectiveThreadId) : undefined;
  const recentThreadSummaryText = useMemo(
    () =>
      effectiveThreadId
        ? resolveRecentThreadSummaryText({
            room,
            threadRootId: effectiveThreadId,
            rootEvent: resolvedThreadRootEvent,
            summaryInfo: threadSummaryInfo,
            t,
          })
        : undefined,
    [effectiveThreadId, resolvedThreadRootEvent, room, t, threadSummaryInfo]
  );

  const leaveThread = useCallback(
    (fallback: () => void) => {
      const historyExitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
      if (
        historyExitTarget?.roomId === roomId &&
        historyExitTarget.threadId === effectiveThreadId
      ) {
        const standaloneWebApp = isIOSStandaloneWebApp();
        if (historyExitTarget.exitPath && (!historyExitTarget.useHistoryBack || standaloneWebApp)) {
          navigatePath(historyExitTarget.exitPath, { replace: true });
          return;
        }
        if (historyExitTarget.useHistoryBack && !standaloneWebApp) {
          window.history.back();
          return;
        }
      }
      fallback();
    },
    [effectiveThreadId, navigatePath, roomId]
  );

  const handleExitThread = useCallback(() => {
    if (!effectiveThreadId) return;
    setLastExitedThread({ roomId, threadId: effectiveThreadId });
    leaveThread(() => navigateRoomFocusEvent(roomId, effectiveThreadId, { replace: true }));
  }, [effectiveThreadId, leaveThread, navigateRoomFocusEvent, roomId, setLastExitedThread]);

  // A deleted unsent root no longer exists, so swipe-forward must not reopen it and the
  // room must not try to focus it.
  const handleThreadRootDeleted = useCallback(
    () => leaveThread(() => navigateRoom(roomId, undefined, { replace: true })),
    [leaveThread, navigateRoom, roomId]
  );

  const handleSwipeForwardToThread = useCallback(() => {
    if (effectiveViewMode === 'classic') return;
    if (threadId) return;
    if (!lastExitedThread || lastExitedThread.roomId !== roomId) return;

    const targetThreadId = lastExitedThread.threadId;
    navigateRoomThread(roomId, targetThreadId);
    setLastExitedThread(null);
  }, [
    effectiveViewMode,
    lastExitedThread,
    navigateRoomThread,
    roomId,
    setLastExitedThread,
    threadId,
  ]);

  useEdgeSwipeBack(handleExitThread, effectiveViewMode !== 'classic' && !!threadId);
  useEdgeSwipeForward(
    handleSwipeForwardToThread,
    effectiveViewMode !== 'classic' && !threadId && lastExitedThread?.roomId === roomId
  );

  // Typed queries apply on a pause, not per keystroke: structured tokens
  // (tag:/is:) parsed mid-word would otherwise refilter the overview with
  // transient one-letter filters ("u", "ur", …) and churn the sort-freeze
  // signature. The search input renders its own draft, so typing stays
  // responsive. Instant filter mutations (chips, presets, tags, sort) FLUSH
  // the pending query first and compose on top of it — the trailing timer
  // would otherwise clobber a click made inside the debounce window, since
  // applyParsedThreadFilterQuery rebuilds every DSL-owned dimension.
  const searchQueryDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout>>();
  const pendingSearchQueryRef = useRef<string>();
  const threadFilterStateRef = useRef(threadFilterState);
  const hasMindroomAgentsRef = useRef(hasMindroomAgents);
  threadFilterStateRef.current = threadFilterState;
  hasMindroomAgentsRef.current = hasMindroomAgents;
  useEffect(() => () => globalThis.clearTimeout(searchQueryDebounceRef.current), []);

  const flushPendingSearchQuery = useCallback((): ThreadFilterState => {
    if (searchQueryDebounceRef.current !== undefined) {
      globalThis.clearTimeout(searchQueryDebounceRef.current);
      searchQueryDebounceRef.current = undefined;
    }
    const pendingQuery = pendingSearchQueryRef.current;
    pendingSearchQueryRef.current = undefined;
    if (pendingQuery === undefined) return threadFilterStateRef.current;
    const applied = hasMindroomAgentsRef.current
      ? applyParsedThreadFilterQuery(
          threadFilterStateRef.current,
          parseThreadFilterQuery(pendingQuery)
        )
      : {
          ...threadFilterStateRef.current,
          // With agent controls hidden, the retained search field is plain
          // text. Preserve agent filters in storage and treat is:/tag: tokens
          // literally instead of mutating invisible filter dimensions.
          freeText: normalizeThreadSearchText(pendingQuery),
          unsupportedQuery: '',
        };
    threadFilterStateRef.current = applied;
    setThreadFilterState(applied);
    return applied;
  }, [setThreadFilterState]);

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      globalThis.clearTimeout(searchQueryDebounceRef.current);
      pendingSearchQueryRef.current = query;
      searchQueryDebounceRef.current = globalThis.setTimeout(() => {
        searchQueryDebounceRef.current = undefined;
        flushPendingSearchQuery();
      }, 300);
    },
    [flushPendingSearchQuery]
  );

  const handleToggle = useCallback(
    (key: ThreadFilterKey) => {
      setThreadFilterState(updateThreadFilterKey(flushPendingSearchQuery(), key));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  // Simple mode's single binary control: unresolved-only on/off. Flips only
  // the resolved dimension so the hidden advanced dimensions survive in
  // storage. ('exclude' is the one resolved value the simple-mode projection
  // keeps, so flipping the raw value matches what the user sees.)
  const handleToggleUnresolvedOnly = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({
      ...base,
      resolved: base.resolved === 'exclude' ? 'any' : 'exclude',
    });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  const handleSortDirectionChange = useCallback(() => {
    const base = flushPendingSearchQuery();
    setThreadFilterState({
      ...base,
      ...cycleSortMode(base),
    });
  }, [flushPendingSearchQuery, setThreadFilterState]);

  const handleToggleThreadSortFreeze = useCallback(() => {
    setThreadSortFreezeState((currentState) =>
      currentState
        ? null
        : {
            controlSignature: null,
            orderedRootIds: [],
          }
    );
  }, []);

  const handleReset = useCallback(() => {
    // Reset discards a pending typed query outright — flushing it first
    // would resurrect the filters the user is clearing.
    globalThis.clearTimeout(searchQueryDebounceRef.current);
    searchQueryDebounceRef.current = undefined;
    pendingSearchQueryRef.current = undefined;
    setThreadFilterState(resetThreadFilterState());
  }, [setThreadFilterState]);

  const handleCycleTag = useCallback(
    (tag: string) => {
      setThreadFilterState(cycleTagFilter(flushPendingSearchQuery(), tag));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleAddTag = useCallback(
    (tag: string) => {
      setThreadFilterState(addTagFilter(flushPendingSearchQuery(), tag));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setThreadFilterState(removeTagFilter(flushPendingSearchQuery(), tag));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      setThreadFilterState(applyPreset(flushPendingSearchQuery(), preset));
    },
    [flushPendingSearchQuery, setThreadFilterState]
  );

  const handleViewModeChange = useCallback(
    (mode: RoomViewMode) => setViewMode(mode),
    [setViewMode]
  );

  const handleRoomMessageSent = useCallback(
    (sentEventId: string): boolean => {
      if (effectiveViewMode !== 'compact' || threadId || effectiveThreadId) return false;
      if (!isConfirmedMatrixEventId(sentEventId) && !isLocalEchoEventId(sentEventId)) return false;

      navigateRoomThread(roomId, sentEventId);
      return true;
    },
    [effectiveThreadId, effectiveViewMode, navigateRoomThread, roomId, threadId]
  );

  useEffect(() => {
    setThreadSortFreezeState(null);
  }, [roomId]);

  useEffect(() => {
    if (!hasMindroomAgents || simpleMode) {
      setThreadSortFreezeState(null);
    }
  }, [hasMindroomAgents, simpleMode]);

  useEffect(() => {
    if (threadId) {
      setLastExitedThread(null);
      return;
    }

    if (lastExitedThread && lastExitedThread.roomId !== roomId) {
      setLastExitedThread(null);
    }
  }, [lastExitedThread, roomId, setLastExitedThread, threadId]);

  useEffect(() => () => setLastExitedThread(null), [setLastExitedThread]);

  useEffect(() => {
    if (threadFilterState.sortBy === 'natural') {
      setThreadSortFreezeState(null);
    }
  }, [threadFilterState.sortBy]);

  useEffect(() => {
    if (!threadId || !effectiveThreadId || threadId === effectiveThreadId) return;

    const historyState: unknown = window.history.state;
    const historyExitTarget = getRoomThreadExitTargetFromHistoryState(historyState);
    let replacementState: Record<string, unknown> | undefined;
    if (historyExitTarget?.roomId === roomId && historyExitTarget.threadId === threadId) {
      const historyUserState =
        typeof historyState === 'object' && historyState !== null && 'usr' in historyState
          ? historyState.usr
          : undefined;
      replacementState = withRoomThreadExitTargetState(historyUserState, {
        ...historyExitTarget,
        threadId: effectiveThreadId,
      });
    }

    navigateRoomThread(roomId, effectiveThreadId, eventId, {
      replace: true,
      ...(replacementState ? { state: replacementState } : {}),
    });
  }, [effectiveThreadId, eventId, navigateRoomThread, roomId, threadId]);

  useEffect(() => {
    if (effectiveViewMode === 'classic' || !isConfirmedMatrixEventId(effectiveThreadId)) return;

    bumpRecentThread(roomId, effectiveThreadId, undefined, recentThreadSummaryText);
  }, [effectiveThreadId, effectiveViewMode, recentThreadSummaryText, roomId]);

  return {
    effectiveThreadId,
    handleAddTag,
    handleApplyPreset,
    handleCycleTag,
    handleExitThread,
    handleThreadRootDeleted,
    handleRemoveTag,
    handleReset,
    handleSearchQueryChange,
    handleSortDirectionChange,
    handleToggle,
    handleToggleThreadSortFreeze,
    handleToggleUnresolvedOnly,
    handleRoomMessageSent,
    handleViewModeChange,
    setThreadSortFreezeState,
    storeThreadSummary,
    summaryMap,
    threadFilterState: effectiveThreadFilterState,
    threadSortFreezeState: effectiveThreadSortFreezeState,
    threadSummaryInfo,
    viewMode: effectiveViewMode,
  };
};
