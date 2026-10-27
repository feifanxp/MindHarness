import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { useDebounce } from '../../hooks/useDebounce';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import {
  getEventTimeline,
  getFirstLinkedTimeline,
} from './timelinePagination';
import type { ThreadInitialRenderMode } from './threadRenderUtils';

type RoomUnreadInfoLike = {
  inLiveTimeline: boolean;
  readUptoEventId: string;
};

type OpenEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void
) => void | Promise<void>;

export const useTimelineReadReceiptController = ({
  atBottom,
  atBottomAnchorRef,
  atBottomRef,
  atLiveEndRef,
  getScrollElement,
  handleOpenEvent,
  hideActivity,
  mx,
  readUptoEventIdRef,
  room,
  setAtBottom,
  threadEventsLength,
  threadId,
  threadInitialRenderMode,
  threadTailLoaded,
  timelineAtLiveEnd,
  unreadInfo,
}: {
  atBottom: boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  atBottomRef: MutableRefObject<boolean>;
  atLiveEndRef: MutableRefObject<boolean>;
  getScrollElement: () => HTMLElement | null | undefined;
  handleOpenEvent: OpenEventHandler;
  hideActivity: boolean;
  mx: MatrixClient;
  readUptoEventIdRef: MutableRefObject<string | undefined>;
  room: Room;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  threadEventsLength: number;
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadTailLoaded: boolean;
  timelineAtLiveEnd: boolean;
  unreadInfo?: RoomUnreadInfoLike;
}) => {
  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
    }
  }, [hideActivity, mx, readUptoEventIdRef, room]);

  const tryAutoMarkThreadAsRead = useCallback(() => {
    if (
      !threadId ||
      threadTailLoaded === false ||
      threadInitialRenderMode === 'loading' ||
      threadEventsLength === 0
    ) {
      return;
    }

    requestAnimationFrame(() => markThreadAsRead(mx, room.roomId, threadId, hideActivity));
  }, [
    hideActivity,
    mx,
    room.roomId,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
  ]);

  const debounceSetAtBottom = useDebounce(
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, [setAtBottom]),
    { wait: 1000 }
  );

  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (document.hasFocus()) {
            if (threadId) {
              tryAutoMarkThreadAsRead();
            } else {
              tryAutoMarkAsRead();
            }
          }
        }
      },
      [
        atBottomAnchorRef,
        atLiveEndRef,
        debounceSetAtBottom,
        setAtBottom,
        threadId,
        tryAutoMarkAsRead,
        tryAutoMarkThreadAsRead,
      ]
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [atBottomAnchorRef])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (inFocus && atBottomRef.current) {
          if (threadId) {
            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // The unread event is already in view, so mark as read immediately.
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [
        atBottomRef,
        atLiveEndRef,
        handleOpenEvent,
        threadId,
        tryAutoMarkAsRead,
        tryAutoMarkThreadAsRead,
        unreadInfo,
      ]
    )
  );

  useEffect(() => {
    if (
      !threadId ||
      !atBottom ||
      !timelineAtLiveEnd ||
      !threadTailLoaded ||
      threadInitialRenderMode === 'loading' ||
      threadEventsLength === 0 ||
      !document.hasFocus()
    ) {
      return;
    }

    tryAutoMarkThreadAsRead();
  }, [
    atBottom,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    tryAutoMarkThreadAsRead,
  ]);

  const handleMarkAsRead = useCallback(() => {
    if (threadId) {
      markThreadAsRead(mx, room.roomId, threadId, hideActivity);
      return;
    }
    markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
  }, [hideActivity, mx, room.roomId, threadId]);

  return { handleMarkAsRead };
};
