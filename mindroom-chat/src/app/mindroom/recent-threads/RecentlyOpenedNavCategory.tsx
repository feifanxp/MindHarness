import React, { useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Scroll, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { archivedRoomsAtom, isRoomVisible } from '../rooms/archivedRooms';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { RoomNavCategoryButton } from '../../features/room-nav';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { makeRecentThreadsAtom, type RecentThreadItem } from './recentThreads';
import { RecentThreadEntry } from './RecentThreadEntry';
import { RECENTLY_OPENED_NAV_CATEGORY_ID } from './recentlyOpenedCategory';
import {
  DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
  MAX_RECENTLY_OPENED_PANEL_HEIGHT,
  MIN_RECENTLY_OPENED_PANEL_HEIGHT,
  RECENTLY_OPENED_PANEL_RESERVED_HEIGHT,
  makeRecentlyOpenedPanelHeightAtom,
} from './recentlyOpenedPanelHeight';
import * as css from './threadNav.css';

export const DEFAULT_RECENTLY_OPENED_THREAD_LIMIT = 10;

const KEYBOARD_RESIZE_STEP = 16;

type DragState = {
  pointerId: number;
  startHeight: number;
  startY: number;
  lastHeight: number;
  maxHeight: number;
};

type VisibleRecentThreadItem = RecentThreadItem & {
  room: Room;
};

type RecentlyOpenedNavCategoryProps = {
  limit?: number;
};

// The list unmounts with its navigation panel on every phone thread open, a
// switch between Home, Direct Messages and spaces, and a collapse, so its
// position lives here, per account.
const recentlyOpenedScrollMemory: ScrollAnchorMemory = new Map();

const clampPanelHeight = (height: number, maxHeight: number): number =>
  Math.min(
    Math.max(MIN_RECENTLY_OPENED_PANEL_HEIGHT, Math.round(height)),
    Math.max(MIN_RECENTLY_OPENED_PANEL_HEIGHT, Math.round(maxHeight))
  );

const getPanelMaxHeight = (panel?: HTMLElement | null): number => {
  const containerHeight = panel?.parentElement?.getBoundingClientRect().height;
  const fallbackHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const availableHeight =
    typeof containerHeight === 'number' && Number.isFinite(containerHeight) && containerHeight > 0
      ? containerHeight
      : fallbackHeight;
  return Math.min(
    MAX_RECENTLY_OPENED_PANEL_HEIGHT,
    Math.max(
      MIN_RECENTLY_OPENED_PANEL_HEIGHT,
      Math.floor(availableHeight - RECENTLY_OPENED_PANEL_RESERVED_HEIGHT)
    )
  );
};

type RecentlyOpenedListProps = {
  entries: VisibleRecentThreadItem[];
  userId: string;
};

function RecentlyOpenedList({ entries, userId }: RecentlyOpenedListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Opening a thread moves its row to the top, so restore by the rows in view.
  useScrollAnchorMemory({
    memory: recentlyOpenedScrollMemory,
    memoryKey: userId,
    scrollRef,
    contentRef,
    ready: entries.length > 0,
  });

  return (
    <div className={css.RecentlyOpenedListViewport}>
      {/* Same Scroll settings as PageNavContent, which scrolls the room
          list directly above this panel. This list used to be a plain
          overflow: auto div, so it was the one place in the sidebar that
          showed the platform's own scrollbar. */}
      <Scroll
        ref={scrollRef}
        className={css.RecentlyOpenedList}
        data-testid="recently-opened-nav-list"
        direction="Vertical"
        hideTrack
        id="recently-opened-nav-list"
        size="300"
        variant="Background"
        visibility="Hover"
      >
        <div ref={contentRef}>
          {entries.length === 0 ? (
            <Text className={css.CategoryState} as="p" size="T200">
              {t('recentThreads.empty')}
            </Text>
          ) : (
            entries.map((entry) => (
              <RecentThreadEntry
                key={`${entry.roomId}|${entry.threadId}`}
                room={entry.room}
                threadId={entry.threadId}
                openedAt={entry.openedAt}
                summaryText={entry.summaryText}
              />
            ))
          )}
        </div>
      </Scroll>
    </div>
  );
}

export function RecentlyOpenedNavCategory({
  limit = DEFAULT_RECENTLY_OPENED_THREAD_LIMIT,
}: RecentlyOpenedNavCategoryProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const recentThreadsAtom = useMemo(() => makeRecentThreadsAtom(userId), [userId]);
  const panelHeightAtom = useMemo(() => makeRecentlyOpenedPanelHeightAtom(userId), [userId]);
  const recentThreads = useAtomValue(recentThreadsAtom);
  const archivedRooms = useAtomValue(archivedRoomsAtom);
  const allRoomIds = useAtomValue(allRoomsAtom);
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const [preferredPanelHeight, setPreferredPanelHeight] = useAtom(panelHeightAtom);
  const [previewPanelHeight, setPreviewPanelHeight] = useState<number>();
  const dragStateRef = useRef<DragState>();
  const panelHeight = previewPanelHeight ?? preferredPanelHeight;
  const closed = closedCategories.has(RECENTLY_OPENED_NAV_CATEGORY_ID);
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );
  const visibleLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : DEFAULT_RECENTLY_OPENED_THREAD_LIMIT;
  const entries = useMemo(() => {
    // allRoomsAtom makes joined-room membership changes reactive; mx.getRoom alone is not.
    void allRoomIds;
    return recentThreads.reduce<VisibleRecentThreadItem[]>((visibleEntries, recentThread) => {
      if (
        visibleEntries.length >= visibleLimit ||
        !isRoomVisible(recentThread.roomId, archivedRooms)
      )
        return visibleEntries;

      const room = mx.getRoom(recentThread.roomId);
      if (!room || room.getMyMembership() !== 'join') return visibleEntries;

      visibleEntries.push({ ...recentThread, room });
      return visibleEntries;
    }, []);
  }, [allRoomIds, archivedRooms, mx, recentThreads, visibleLimit]);

  const commitPanelHeight = (height: number, maxHeight: number) => {
    const nextHeight = clampPanelHeight(height, maxHeight);
    setPreviewPanelHeight(undefined);
    setPreferredPanelHeight(nextHeight);
  };

  const handleResizePointerDown = (evt: React.PointerEvent<HTMLDivElement>) => {
    const panel = evt.currentTarget.parentElement;
    if (!panel) return;

    evt.preventDefault();
    const maxHeight = getPanelMaxHeight(panel);
    const startHeight = clampPanelHeight(preferredPanelHeight, maxHeight);
    dragStateRef.current = {
      pointerId: evt.pointerId,
      startHeight,
      startY: evt.clientY,
      lastHeight: startHeight,
      maxHeight,
    };
    evt.currentTarget.setPointerCapture(evt.pointerId);
  };

  const handleResizePointerMove = (evt: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== evt.pointerId) return;

    const nextHeight = clampPanelHeight(
      dragState.startHeight - (evt.clientY - dragState.startY),
      dragState.maxHeight
    );
    dragState.lastHeight = nextHeight;
    setPreviewPanelHeight(nextHeight);
  };

  const finishResize = (evt: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== evt.pointerId) return;

    dragStateRef.current = undefined;
    if (evt.currentTarget.hasPointerCapture(evt.pointerId)) {
      evt.currentTarget.releasePointerCapture(evt.pointerId);
    }
    if (commit) {
      commitPanelHeight(dragState.lastHeight, dragState.maxHeight);
    } else {
      setPreviewPanelHeight(undefined);
    }
  };

  const handleResizeKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    const panel = evt.currentTarget.parentElement;
    const maxHeight = getPanelMaxHeight(panel);
    const currentHeight = clampPanelHeight(preferredPanelHeight, maxHeight);
    let nextHeight: number | undefined;

    if (evt.key === 'ArrowUp') nextHeight = currentHeight + KEYBOARD_RESIZE_STEP;
    if (evt.key === 'ArrowDown') nextHeight = currentHeight - KEYBOARD_RESIZE_STEP;
    if (evt.key === 'Home') nextHeight = MIN_RECENTLY_OPENED_PANEL_HEIGHT;
    if (evt.key === 'End') nextHeight = maxHeight;
    if (evt.key === 'Enter') nextHeight = DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT;
    if (nextHeight === undefined) return;

    evt.preventDefault();
    commitPanelHeight(nextHeight, maxHeight);
  };

  const handleResizeDoubleClick = (evt: React.MouseEvent<HTMLDivElement>) => {
    commitPanelHeight(
      DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
      getPanelMaxHeight(evt.currentTarget.parentElement)
    );
  };

  const maxPanelHeight = getPanelMaxHeight();
  const renderedPanelHeight = clampPanelHeight(panelHeight, maxPanelHeight);

  return (
    <div
      className={css.RecentlyOpenedPanel}
      data-collapsed={closed}
      data-testid="recently-opened-nav-panel"
      style={
        closed
          ? undefined
          : {
              maxHeight: `min(${panelHeight}px, calc(100% - ${RECENTLY_OPENED_PANEL_RESERVED_HEIGHT}px))`,
            }
      }
    >
      {!closed && (
        <>
          {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          <div
            aria-label={t('recentThreads.resizeAria')}
            aria-controls="recently-opened-nav-list"
            aria-orientation="horizontal"
            aria-valuemax={maxPanelHeight}
            aria-valuemin={MIN_RECENTLY_OPENED_PANEL_HEIGHT}
            aria-valuenow={renderedPanelHeight}
            className={css.RecentlyOpenedResizeHandle}
            data-testid="recently-opened-resize-handle"
            onDoubleClick={handleResizeDoubleClick}
            onKeyDown={handleResizeKeyDown}
            onPointerCancel={(evt) => finishResize(evt, false)}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={(evt) => finishResize(evt, true)}
            role="separator"
            tabIndex={0}
          >
            <span aria-hidden="true" className={css.RecentlyOpenedResizeGrip} />
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        </>
      )}
      <NavCategory
        className={css.RecentlyOpenedCategory}
        data-testid="recently-opened-nav-category"
      >
        <NavCategoryHeader>
          <RoomNavCategoryButton
            closed={closed}
            data-category-id={RECENTLY_OPENED_NAV_CATEGORY_ID}
            onClick={handleCategoryClick}
          >
            {t('recentThreads.title')}
          </RoomNavCategoryButton>
        </NavCategoryHeader>
        {!closed && <RecentlyOpenedList key={userId} entries={entries} userId={userId} />}
      </NavCategory>
    </div>
  );
}
