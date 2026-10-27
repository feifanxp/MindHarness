import React, {
  type MutableRefObject,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box, Icon, IconButton, Icons, Text, type RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactThreadCard } from './CompactThreadCard';
import { CompactCardSwipe } from './CompactCardSwipe';
import * as css from './CompactRoomView.css';
import { useToggleThreadResolution } from './useRoomThreadTags';
import { InsetScrollbar } from '../../components/inset-scrollbar/InsetScrollbar';
import * as overlay from './RoomOverlay.css';
import { useThreadPinning } from './useThreadPinning';
import { isConfirmedMatrixEventId } from './threadRouteUtils';
import { useInitializeShownThread } from './useInitializeShownThread';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { IconTooltip } from '../tooltip/IconTooltip';

const ThreadActionsMenu = lazy(() =>
  import('./ThreadActionsMenu').then((module) => ({ default: module.ThreadActionsMenu }))
);

export type CompactRoomViewProps = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  compactRoomScrollStateRef: MutableRefObject<ScrollAnchorMemory>;
};

type ThreadActionsMenuState = {
  roomId: string;
  rootId: string;
  anchor: RectCords;
  trigger?: HTMLElement;
  viewModel: CompactThreadCardViewModel;
};

type CompactThreadCardRowProps = {
  roomId: string;
  viewModel: CompactThreadCardViewModel;
  pinned: boolean;
  showResolveAction: boolean;
  showPinAction: boolean;
  actionsDisabled: boolean;
  swipeEnabled: boolean;
  menuOpen: boolean;
  resolveLabel: string;
  reopenLabel: string;
  pinLabel: string;
  moreLabel: string;
  onThreadClick: (threadRootId: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onPin: (threadRootId: string, pinned: boolean) => void;
  onOpenMenu: (menu: ThreadActionsMenuState) => void;
};

const CompactThreadCardRow = React.memo(
  ({
    roomId,
    viewModel,
    pinned,
    showResolveAction,
    showPinAction,
    actionsDisabled,
    swipeEnabled,
    menuOpen,
    resolveLabel,
    reopenLabel,
    pinLabel,
    moreLabel,
    onThreadClick,
    onSetResolved,
    onPin,
    onOpenMenu,
  }: CompactThreadCardRowProps) => {
    const rootId = viewModel.id.threadRootId;
    const shownRef = useInitializeShownThread(roomId, rootId);

    return (
      <div
        ref={shownRef}
        className={css.CardShell}
        data-scroll-anchor={rootId}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            roomId,
            rootId,
            viewModel,
            anchor: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
            trigger:
              event.currentTarget.querySelector<HTMLButtonElement>('[data-thread-root-id]') ??
              undefined,
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            roomId,
            rootId,
            viewModel,
            anchor: event.currentTarget.getBoundingClientRect(),
            trigger: event.target as HTMLElement,
          });
        }}
      >
        <CompactCardSwipe
          enabled={swipeEnabled}
          resolved={viewModel.isResolved}
          label={viewModel.isResolved ? reopenLabel : resolveLabel}
          onSwipe={(wasResolved) => onSetResolved(rootId, !wasResolved)}
        >
          <CompactThreadCard viewModel={viewModel} onClick={onThreadClick} />
          <div className={css.CardAction}>
            {showResolveAction && (
              <IconTooltip label={resolveLabel} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    className={css.CardQuickAction}
                    type="button"
                    size="300"
                    variant="Secondary"
                    fill="None"
                    radii="300"
                    aria-label={resolveLabel}
                    disabled={actionsDisabled}
                    onClick={() => onSetResolved(rootId, true)}
                    data-compact-thread-resolve="true"
                  >
                    <Icon size="100" src={Icons.Check} />
                  </IconButton>
                )}
              </IconTooltip>
            )}
            {showPinAction && (
              <IconTooltip label={pinLabel} position="Top">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    className={css.CardQuickAction}
                    type="button"
                    size="300"
                    variant="Secondary"
                    fill="None"
                    radii="300"
                    aria-label={pinLabel}
                    disabled={actionsDisabled}
                    onClick={() => onPin(rootId, pinned)}
                    data-compact-thread-pin="true"
                  >
                    <Icon size="100" src={Icons.Pin} filled={pinned} />
                  </IconButton>
                )}
              </IconTooltip>
            )}
            <IconTooltip label={moreLabel} position="Top">
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  className={css.CardMenuButton}
                  type="button"
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label={moreLabel}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                    onOpenMenu({
                      roomId,
                      rootId,
                      viewModel,
                      anchor: event.currentTarget.getBoundingClientRect(),
                      trigger: event.currentTarget,
                    })
                  }
                >
                  <Icon size="100" src={Icons.HorizontalDots} />
                </IconButton>
              )}
            </IconTooltip>
          </div>
        </CompactCardSwipe>
      </div>
    );
  }
);

export function CompactRoomView({
  room,
  threadRootIds,
  threadRecordMap,
  onThreadClick,
  compactRoomScrollStateRef,
}: CompactRoomViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds,
    threadRecordMap,
  });
  const { canToggle, setResolved, updatingThreadRootIds, error } = useToggleThreadResolution(room);
  const pinning = useThreadPinning(room);
  const [menu, setMenu] = useState<ThreadActionsMenuState>();
  const menuRef = useRef<ThreadActionsMenuState>();
  const openMenu = useCallback((nextMenu: ThreadActionsMenuState) => {
    menuRef.current = nextMenu;
    setMenu(nextMenu);
  }, []);
  const closeMenu = (selectedMenu: ThreadActionsMenuState) => {
    if (menuRef.current !== selectedMenu) return;
    menuRef.current = undefined;
    setMenu(undefined);
    const trigger = selectedMenu.trigger?.isConnected
      ? selectedMenu.trigger
      : viewRef.current?.querySelector<HTMLButtonElement>(
          `[data-thread-root-id="${CSS.escape(selectedMenu.rootId)}"]`
        ) ?? viewRef.current;
    trigger?.focus();
  };
  const menuModel =
    menu?.roomId === room.roomId
      ? cardViewModels.find((model) => model.id.threadRootId === menu.rootId) ?? menu.viewModel
      : undefined;
  useLayoutEffect(() => {
    menuRef.current = undefined;
    setMenu(undefined);
  }, [room.roomId]);
  const pinnedCards = cardViewModels.filter((model) =>
    pinning.pinnedEventIds.includes(model.id.threadRootId)
  );
  const ordinaryCards = cardViewModels.filter(
    (model) => !pinning.pinnedEventIds.includes(model.id.threadRootId)
  );

  // A fully stable click handler keeps the memoized cards from re-rendering
  // when unrelated threads update; the per-thread summary text and the latest
  // onThreadClick are resolved through refs at click time.
  const viewModelByRootRef = useRef<ReadonlyMap<string, CompactThreadCardViewModel>>(new Map());
  const onThreadClickRef = useRef(onThreadClick);
  const setResolvedRef = useRef(setResolved);
  const setPinnedRef = useRef(pinning.setPinned);
  // Synced after commit (not during render) so a discarded concurrent render
  // cannot leave uncommitted view models behind the stable click handler.
  useLayoutEffect(() => {
    viewModelByRootRef.current = new Map(
      cardViewModels.map((viewModel) => [viewModel.id.threadRootId, viewModel])
    );
    onThreadClickRef.current = onThreadClick;
    setResolvedRef.current = setResolved;
    setPinnedRef.current = pinning.setPinned;
  });
  const handleCardClick = useCallback((clickedThreadRootId: string) => {
    const viewModel = viewModelByRootRef.current.get(clickedThreadRootId);
    onThreadClickRef.current(clickedThreadRootId, viewModel?.recentThreadSummaryText);
  }, []);
  const handleSetResolved = useCallback((threadRootId: string, resolved: boolean) => {
    void setResolvedRef.current(threadRootId, resolved);
  }, []);
  const handlePin = useCallback((threadRootId: string, pinned: boolean) => {
    void setPinnedRef.current(threadRootId, !pinned);
  }, []);

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[CompactRoomView] Resolve failed:', error);
    }
  }, [error]);

  // Opening a card remounts this view, and threads that got replies meanwhile
  // sort above the cards that were in view, so restore by those cards.
  useScrollAnchorMemory({
    memory: compactRoomScrollStateRef.current,
    memoryKey: room.roomId,
    scrollRef: viewRef,
    contentRef,
    ready: cardViewModels.length > 0,
  });

  const resolveLabel = t('thread.resolve');
  const reopenLabel = t('threadActions.reopen');
  const pinLabel = t('threadNav.pin');
  const unpinLabel = t('threadNav.unpin');
  const moreLabel = t('threadActions.more');
  const renderCard = (viewModel: CompactThreadCardViewModel) => {
    const rootId = viewModel.id.threadRootId;
    const pinned = pinning.pinnedEventIds.includes(rootId);
    const showResolveAction = canToggle && !viewModel.isResolved && !pinned;
    // Touch screens hide the hover Resolve button; a swipe resolves or reopens.
    const swipeEnabled =
      canToggle &&
      !pinned &&
      isConfirmedMatrixEventId(rootId) &&
      !updatingThreadRootIds.has(rootId);
    const showPinAction = pinning.canPin && isConfirmedMatrixEventId(rootId);
    return (
      <CompactThreadCardRow
        key={rootId}
        roomId={room.roomId}
        viewModel={viewModel}
        pinned={pinned}
        showResolveAction={showResolveAction}
        showPinAction={showPinAction}
        actionsDisabled={
          (showResolveAction || showPinAction) &&
          (pinning.updating || updatingThreadRootIds.has(rootId))
        }
        swipeEnabled={swipeEnabled}
        menuOpen={menu?.rootId === rootId && !!menuModel}
        resolveLabel={resolveLabel}
        reopenLabel={reopenLabel}
        pinLabel={pinned ? unpinLabel : pinLabel}
        moreLabel={moreLabel}
        onThreadClick={handleCardClick}
        onSetResolved={handleSetResolved}
        onPin={handlePin}
        onOpenMenu={openMenu}
      />
    );
  };

  return (
    <Box ref={viewRef} className={css.View} data-compact-room-view="true" tabIndex={-1}>
      <Box ref={contentRef} direction="Column" gap="100" shrink="No">
        {!!pinning.error && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {pinnedCards.length > 0 && (
          <Box
            as="section"
            direction="Column"
            gap="100"
            className={css.PinnedSection}
            aria-label={t('threadNav.pinned')}
            data-pinned-threads="true"
          >
            <Box alignItems="Center" gap="100">
              <Icon src={Icons.Pin} size="100" />
              <Text as="h2" size="L400">
                {t('threadNav.pinned')}
              </Text>
            </Box>
            {pinnedCards.map(renderCard)}
          </Box>
        )}
        {threadRootIds.length === 0 ? (
          <Box className={css.EmptyState}>
            <Text size="T300" priority="300">
              {t('mindroomUi.threads.compactRoomView.noThreads')}
            </Text>
          </Box>
        ) : (
          ordinaryCards.map(renderCard)
        )}
      </Box>
      <InsetScrollbar
        scrollRef={viewRef}
        contentRef={contentRef}
        className={overlay.Scrollbar}
        label={t('threadNav.messages')}
      />
      {menu && menuModel && (
        <Suspense fallback={null}>
          <ThreadActionsMenu
            key={`${room.roomId}:${menu.rootId}`}
            room={room}
            rootId={menu.rootId}
            summaryText={menuModel.primarySummaryText}
            anchor={menu.anchor}
            onClose={() => closeMenu(menu)}
            onOpenThread={() => {
              if (menuRef.current !== menu) return;
              menuRef.current = undefined;
              setMenu(undefined);
              handleCardClick(menu.rootId);
            }}
          />
        </Suspense>
      )}
    </Box>
  );
}
