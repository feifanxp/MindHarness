import { useTranslation } from 'react-i18next';
import React, {
  CSSProperties,
  MouseEventHandler,
  ReactNode,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Icon, IconButton, Icons, Line, PopOut, RectCords, Text, config, toRem } from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { Room } from 'matrix-js-sdk';
import {
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FocusTrap from 'focus-trap-react';
import { Menu, MenuItem } from '../../../components/glass/GlassPrimitives';
import {
  useOrphanSpaces,
  useRecursiveChildScopeFactory,
  useSpaceChildren,
} from '../../../state/hooks/roomList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { navigationRoomToUnreadAtom } from '../../../mindroom/rooms/navigationUnread';
import { navigationRoomsAtom } from '../../../mindroom/rooms/archivedRooms';
import { getSpaceLobbyPath, getSpacePath, joinPathComponent } from '../../pathUtils';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
  SidebarStack,
  SidebarStackSeparator,
  SidebarFolder,
  SidebarFolderDropTarget,
} from '../../../components/sidebar';
import { SidebarDragSource } from '../../../components/sidebar/Sidebar.css';
import { RoomUnreadProvider, RoomsUnreadProvider } from '../../../components/RoomUnreadProvider';
import { useSelectedSpace } from '../../../hooks/router/useSelectedSpace';
import { UnreadBadge } from '../../../components/unread-badge';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../../../utils/matrix';
import { RoomAvatar } from '../../../components/room-avatar';
import { nameInitials } from '../../../utils/common';
import {
  ISidebarFolder,
  SidebarItems,
  makeCinnySpacesContent,
  parseSidebar,
  sidebarItemWithout,
  useSidebarItems,
} from '../../../hooks/useSidebarItems';
import { AccountDataEvent } from '../../../../types/matrix/accountData';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { useOpenedSidebarFolderAtom } from '../../../state/hooks/openedSidebarFolder';
import { useSpaceOrderAtom } from '../../../state/hooks/sidebarOrder';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { copyToClipboard } from '../../../utils/dom';
import { stopPropagation } from '../../../utils/keyboard';
import { getMatrixToRoom } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { getRoomAvatarUrl } from '../../../utils/room';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useOpenSpaceSettings } from '../../../state/hooks/spaceSettings';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../../components/invite-user-prompt';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { applyOrderOverride } from '../../../state/utils/applyOrderOverride';
import {
  animateSortableLayoutDuringDrag,
  suppressNextClickDefaultAfterPointerDrag,
} from '../../../utils/sortableDrag';
import {
  FolderDraggable,
  InstructionType,
  SidebarDraggable,
  commitSidebarReorder,
} from './sidebarReorder';

type SpaceMenuProps = {
  room: Room;
  requestClose: () => void;
  onUnpin?: (roomId: string) => void;
};
const SpaceMenu = forwardRef<HTMLDivElement, SpaceMenuProps>(
  ({ room, requestClose, onUnpin }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevels(room);
    const creators = useRoomCreators(room);

    const permissions = useRoomPermissions(creators, powerLevels);
    const canInvite = permissions.action('invite', mx.getSafeUserId());
    const openSpaceSettings = useOpenSpaceSettings();

    const [invitePrompt, setInvitePrompt] = useState(false);

    const allChild = useSpaceChildren(
      navigationRoomsAtom,
      room.roomId,
      useRecursiveChildScopeFactory(mx, roomToParents)
    );

    const handleUnpin = () => {
      onUnpin?.(room.roomId);
      requestClose();
    };

    const handleCopyLink = () => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
      const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
      copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      requestClose();
    };

    const handleInvite = () => {
      setInvitePrompt(true);
    };

    const handleRoomSettings = () => {
      openSpaceSettings(room.roomId);
      requestClose();
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
        {invitePrompt && room && (
          <InviteUserPrompt
            room={room}
            requestClose={() => {
              setInvitePrompt(false);
              requestClose();
            }}
          />
        )}
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MindroomMarkRoomsReadMenuItem roomIds={allChild} onClose={requestClose} />
          {onUnpin && (
            <MenuItem
              size="300"
              radii="300"
              onClick={handleUnpin}
              after={<Icon size="100" src={Icons.Pin} />}
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                {t('sharedUi.spaceTabs.unpin')}
              </Text>
            </MenuItem>
          )}
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem
            onClick={handleInvite}
            variant="Primary"
            fill="None"
            size="300"
            after={<Icon size="100" src={Icons.UserPlus} />}
            radii="300"
            aria-pressed={invitePrompt}
            disabled={!canInvite}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('sharedUi.spaceTabs.invite')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleCopyLink}
            size="300"
            after={<Icon size="100" src={Icons.Link} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('sharedUi.spaceTabs.copyLink')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleRoomSettings}
            size="300"
            after={<Icon size="100" src={Icons.Setting} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('sharedUi.spaceTabs.spaceSettings')}
            </Text>
          </MenuItem>
        </Box>
      </Menu>
    );
  }
);

type SidebarDndData = {
  item: SidebarDraggable;
  instructionType?: InstructionType;
};

type DropInstruction = {
  overId: string;
  instructionType: InstructionType;
};

const sidebarItemDndId = (item: SidebarDraggable): string => {
  if (typeof item === 'string') return `space:${item}`;
  if (item.spaceId) return `folder-space:${item.folder.id}:${item.spaceId}`;
  return `folder:${item.folder.id}`;
};

const folderDropDndId = (folderId: string, instructionType: InstructionType): string =>
  `folder-drop:${folderId}:${instructionType}`;

const getSidebarDndData = (data: unknown): SidebarDndData | undefined =>
  data && typeof data === 'object' && 'item' in data ? (data as SidebarDndData) : undefined;

const instructionFromDragEvent = (
  event: DragMoveEvent | DragEndEvent
): InstructionType | undefined => {
  const over = event.over;
  if (!over) return undefined;

  const activeData = getSidebarDndData(event.active.data.current);
  const overData = getSidebarDndData(over.data.current);
  if (!activeData || !overData) return undefined;

  if (overData.instructionType) return overData.instructionType;

  const overItem = overData.item;
  const activeRect = event.active.rect.current.translated;
  const overRect = over.rect;
  const activeCenterY = activeRect
    ? activeRect.top + activeRect.height / 2
    : overRect.top + overRect.height / 2;
  const relativeY = (activeCenterY - overRect.top) / overRect.height;
  const canMakeChild =
    typeof overItem === 'string' || (typeof overItem === 'object' && !overItem.spaceId);

  if (canMakeChild && relativeY > 0.25 && relativeY < 0.75) {
    return 'make-child';
  }

  return relativeY < 0.5 ? 'reorder-above' : 'reorder-below';
};

const orderedSidebarItems = (items: SidebarItems, orderOverride: string[]): SidebarItems => {
  const topLevelSpaceIds = items.filter((item): item is string => typeof item === 'string');
  const orderedSpaceIds = applyOrderOverride(topLevelSpaceIds, orderOverride);
  let spaceIndex = 0;

  return items.map((item) => {
    if (typeof item === 'string') {
      const orderedSpaceId = orderedSpaceIds[spaceIndex];
      spaceIndex += 1;
      return orderedSpaceId;
    }
    return item;
  });
};

const visibleSidebarDndIds = (items: SidebarItems, openedFolder: Set<string>): string[] =>
  items.flatMap((item) => {
    if (typeof item === 'string') return [sidebarItemDndId(item)];
    if (!openedFolder.has(item.id)) return [sidebarItemDndId({ folder: item })];
    return item.content.map((spaceId) => sidebarItemDndId({ folder: item, spaceId }));
  });

const sidebarItemTransformStyle = (
  transform: ReturnType<typeof useSortable>['transform'],
  transition: ReturnType<typeof useSortable>['transition'],
  dragging: boolean
): CSSProperties => ({
  transform: CSS.Transform.toString(transform),
  transition,
  opacity: dragging ? 0.45 : undefined,
});

type SpaceTabProps = {
  space: Room;
  selected: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  folder?: ISidebarFolder;
  dropInstruction?: DropInstruction;
  disabled?: boolean;
  onUnpin?: (roomId: string) => void;
};
function SpaceTab({
  space,
  selected,
  onClick,
  folder,
  dropInstruction,
  disabled,
  onUnpin,
}: SpaceTabProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const spaceDraggable: SidebarDraggable = useMemo(
    () =>
      folder
        ? {
            folder,
            spaceId: space.roomId,
          }
        : space.roomId,
    [folder, space]
  );
  const dndId = sidebarItemDndId(spaceDraggable);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dndId,
    animateLayoutChanges: animateSortableLayoutDuringDrag,
    data: {
      item: spaceDraggable,
    } satisfies SidebarDndData,
  });

  const dropType = dropInstruction?.overId === dndId ? dropInstruction.instructionType : undefined;

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  useEffect(() => {
    if (isDragging) setMenuAnchor(undefined);
  }, [isDragging]);

  const handleContextMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    evt.preventDefault();
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <RoomUnreadProvider roomId={space.roomId} unreadAtom={navigationRoomToUnreadAtom}>
      {(unread) => (
        <SidebarItem
          active={selected}
          ref={setNodeRef}
          style={sidebarItemTransformStyle(transform, transition, isDragging)}
          aria-disabled={disabled}
          data-drop-child={dropType === 'make-child'}
          data-drop-above={dropType === 'reorder-above'}
          data-drop-below={dropType === 'reorder-below'}
          data-inside-folder={!!folder}
        >
          <SidebarItemTooltip tooltip={disabled ? undefined : space.name}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                className={SidebarDragSource}
                data-id={space.roomId}
                ref={(node: HTMLElement | null) => {
                  triggerRef(node);
                  setActivatorNodeRef(node);
                }}
                size={folder ? '300' : '400'}
                onClick={onClick}
                onContextMenu={handleContextMenu}
                {...attributes}
                {...listeners}
              >
                <RoomAvatar
                  roomId={space.roomId}
                  src={getRoomAvatarUrl(mx, space, 96, useAuthentication) ?? undefined}
                  alt={space.name}
                  renderFallback={() => (
                    <Text size={folder ? 'H6' : 'H4'}>{nameInitials(space.name, 2)}</Text>
                  )}
                />
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
          {unread && (
            <SidebarItemBadge hasCount={unread.total > 0}>
              <UnreadBadge highlight={unread.highlight > 0} count={unread.total} />
            </SidebarItemBadge>
          )}
          {menuAnchor && (
            <PopOut
              anchor={menuAnchor}
              position="Right"
              align="Start"
              content={
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    returnFocusOnDeactivate: false,
                    onDeactivate: () => setMenuAnchor(undefined),
                    clickOutsideDeactivates: true,
                    isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                    isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <SpaceMenu
                    room={space}
                    requestClose={() => setMenuAnchor(undefined)}
                    onUnpin={onUnpin}
                  />
                </FocusTrap>
              }
            />
          )}
        </SidebarItem>
      )}
    </RoomUnreadProvider>
  );
}

type OpenedSpaceFolderProps = {
  folder: ISidebarFolder;
  onClose: MouseEventHandler<HTMLButtonElement>;
  dropInstruction?: DropInstruction;
  children?: ReactNode;
};
function OpenedSpaceFolder({ folder, onClose, dropInstruction, children }: OpenedSpaceFolderProps) {
  const spaceDraggable: SidebarDraggable = useMemo(() => ({ folder, open: true }), [folder]);
  const aboveId = folderDropDndId(folder.id, 'reorder-above');
  const belowId = folderDropDndId(folder.id, 'reorder-below');
  const { setNodeRef: setAboveNodeRef } = useDroppable({
    id: aboveId,
    data: {
      item: spaceDraggable,
      instructionType: 'reorder-above',
    } satisfies SidebarDndData,
  });
  const { setNodeRef: setBelowNodeRef } = useDroppable({
    id: belowId,
    data: {
      item: spaceDraggable,
      instructionType: 'reorder-below',
    } satisfies SidebarDndData,
  });

  const orderAbove =
    dropInstruction?.overId === aboveId ? dropInstruction.instructionType : undefined;
  const orderBelow =
    dropInstruction?.overId === belowId ? dropInstruction.instructionType : undefined;

  return (
    <SidebarFolder
      state="Open"
      data-drop-above={orderAbove === 'reorder-above'}
      data-drop-below={orderBelow === 'reorder-below'}
    >
      <SidebarFolderDropTarget ref={setAboveNodeRef} position="Top" />
      <SidebarAvatar size="300">
        <IconButton data-id={folder.id} size="300" variant="Background" onClick={onClose}>
          <Icon size="400" src={Icons.ChevronTop} filled />
        </IconButton>
      </SidebarAvatar>
      {children}
      <SidebarFolderDropTarget ref={setBelowNodeRef} position="Bottom" />
    </SidebarFolder>
  );
}

type ClosedSpaceFolderProps = {
  folder: ISidebarFolder;
  selected: boolean;
  onOpen: MouseEventHandler<HTMLButtonElement>;
  dropInstruction?: DropInstruction;
  disabled?: boolean;
};
function ClosedSpaceFolder({
  folder,
  selected,
  onOpen,
  dropInstruction,
  disabled,
}: ClosedSpaceFolderProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const spaceDraggable: FolderDraggable = useMemo(() => ({ folder }), [folder]);
  const dndId = sidebarItemDndId(spaceDraggable);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dndId,
    animateLayoutChanges: animateSortableLayoutDuringDrag,
    data: {
      item: spaceDraggable,
    } satisfies SidebarDndData,
  });
  const dropType = dropInstruction?.overId === dndId ? dropInstruction.instructionType : undefined;

  const tooltipName =
    folder.name ?? folder.content.map((i) => mx.getRoom(i)?.name ?? '').join(', ') ?? 'Unnamed';

  return (
    <RoomsUnreadProvider rooms={folder.content} unreadAtom={navigationRoomToUnreadAtom}>
      {(unread) => (
        <SidebarItem
          active={selected}
          ref={setNodeRef}
          style={sidebarItemTransformStyle(transform, transition, isDragging)}
          aria-disabled={disabled}
          data-drop-child={dropType === 'make-child'}
          data-drop-above={dropType === 'reorder-above'}
          data-drop-below={dropType === 'reorder-below'}
        >
          <SidebarItemTooltip tooltip={disabled ? undefined : tooltipName}>
            {(tooltipRef) => (
              <SidebarFolder
                data-id={folder.id}
                as="button"
                className={SidebarDragSource}
                ref={(node: HTMLElement | null) => {
                  tooltipRef(node);
                  setActivatorNodeRef(node);
                }}
                onClick={onOpen}
                {...attributes}
                {...listeners}
              >
                {folder.content.map((sId) => {
                  const space = mx.getRoom(sId);
                  if (!space) return null;

                  return (
                    <SidebarAvatar key={sId} size="200" radii="300">
                      <RoomAvatar
                        roomId={space.roomId}
                        src={getRoomAvatarUrl(mx, space, 96, useAuthentication) ?? undefined}
                        alt={space.name}
                        renderFallback={() => (
                          <Text size="Inherit">
                            <b>{nameInitials(space.name, 2)}</b>
                          </Text>
                        )}
                      />
                    </SidebarAvatar>
                  );
                })}
              </SidebarFolder>
            )}
          </SidebarItemTooltip>
          {unread && (
            <SidebarItemBadge hasCount={unread.total > 0}>
              <UnreadBadge highlight={unread.highlight > 0} count={unread.total} />
            </SidebarItemBadge>
          )}
        </SidebarItem>
      )}
    </RoomsUnreadProvider>
  );
}

type SpaceTabsProps = {
  scrollRef: RefObject<HTMLDivElement>;
  onSelect?: (selected: boolean) => boolean;
};
export function SpaceTabs({ scrollRef, onSelect }: SpaceTabsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const orphanSpaces = useOrphanSpaces(mx, navigationRoomsAtom, roomToParents);
  const [baseSidebarItems, localEchoSidebarItem] = useSidebarItems(orphanSpaces);
  const [spaceOrder, setSpaceOrder] = useAtom(useSpaceOrderAtom());
  const sidebarItems = useMemo(
    () => orderedSidebarItems(baseSidebarItems, spaceOrder),
    [baseSidebarItems, spaceOrder]
  );
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const [openedFolder, setOpenedFolder] = useAtom(useOpenedSidebarFolderAtom());
  const [draggingItem, setDraggingItem] = useState<SidebarDraggable>();
  const [dropInstruction, setDropInstruction] = useState<DropInstruction>();
  const dndIds = useMemo(
    () => visibleSidebarDndIds(sidebarItems, openedFolder),
    [sidebarItems, openedFolder]
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleReorder = useCallback(
    (item: SidebarDraggable, containerItem: SidebarDraggable, instructionType: InstructionType) => {
      commitSidebarReorder({
        mx,
        orphanSpaces,
        sidebarItems,
        accountDataSidebarItems: baseSidebarItems,
        item,
        containerItem,
        instructionType,
        onEmptyFolder: (folderId) => {
          setOpenedFolder({ type: 'DELETE', id: folderId });
        },
        localEchoSidebarItem,
        setSpaceOrder,
      });
    },
    [
      mx,
      orphanSpaces,
      sidebarItems,
      baseSidebarItems,
      setOpenedFolder,
      localEchoSidebarItem,
      setSpaceOrder,
    ]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const item = getSidebarDndData(event.active.data.current)?.item;
    setDraggingItem(item);
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const instructionType = instructionFromDragEvent(event);
    const overId = event.over?.id;
    setDropInstruction(
      instructionType && overId ? { overId: overId.toString(), instructionType } : undefined
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
      setDraggingItem(undefined);
      setDropInstruction(undefined);
      if (!event.over || event.active.id === event.over.id) return;

      const activeData = getSidebarDndData(event.active.data.current);
      const overData = getSidebarDndData(event.over.data.current);
      const instructionType = instructionFromDragEvent(event);
      if (!activeData || !overData || !instructionType) return;

      handleReorder(activeData.item, overData.item, instructionType);
    },
    [handleReorder]
  );

  const handleDragCancel = useCallback((event: DragCancelEvent) => {
    suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
    setDraggingItem(undefined);
    setDropInstruction(undefined);
  }, []);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) throw Error('Scroll element ref not configured');
  }, [scrollRef]);

  const selectedSpaceId = useSelectedSpace();

  const handleSpaceClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (evt.defaultPrevented) return;
    const target = evt.currentTarget;
    const targetSpaceId = target.getAttribute('data-id');
    if (!targetSpaceId) return;

    if (onSelect?.(targetSpaceId === selectedSpaceId)) return;
    const spacePath = getSpacePath(getCanonicalAliasOrRoomId(mx, targetSpaceId));
    if (screenSize === ScreenSize.Mobile && targetSpaceId !== selectedSpaceId) {
      navigate(spacePath);
      return;
    }

    const activePath = navToActivePath.get(targetSpaceId);
    if (activePath && activePath.pathname.startsWith(spacePath)) {
      navigate(joinPathComponent(activePath));
      return;
    }

    if (screenSize === ScreenSize.Mobile) {
      navigate(spacePath);
      return;
    }

    navigate(getSpaceLobbyPath(getCanonicalAliasOrRoomId(mx, targetSpaceId)));
  };

  const handleFolderToggle: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const target = evt.currentTarget;
    const targetFolderId = target.getAttribute('data-id');
    if (!targetFolderId) return;

    setOpenedFolder({
      type: openedFolder.has(targetFolderId) ? 'DELETE' : 'PUT',
      id: targetFolderId,
    });
  };

  const handleUnpin = useCallback(
    (roomId: string) => {
      if (orphanSpaces.includes(roomId)) return;
      const newItems = sidebarItemWithout(sidebarItems, roomId);

      const newSpacesContent = makeCinnySpacesContent(mx, newItems);
      localEchoSidebarItem(parseSidebar(mx, orphanSpaces, newSpacesContent));
      mx.setAccountData(AccountDataEvent.CinnySpaces as any, newSpacesContent as any);
      setSpaceOrder({ type: 'REMOVE', id: roomId });
    },
    [mx, sidebarItems, orphanSpaces, localEchoSidebarItem, setSpaceOrder]
  );

  if (sidebarItems.length === 0) return null;
  return (
    <>
      <SidebarStackSeparator />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements: {
            onDragStart({ active }) {
              const item = getSidebarDndData(active.data.current)?.item;
              const label =
                typeof item === 'string'
                  ? mx.getRoom(item)?.name ?? item
                  : item?.folder.name ?? 'folder';
              return t('sharedUi.spaceTabs.pickedUpSpaceValue1UseArrowKeysToReorderPressSpaceTo', {
                value1: label,
              });
            },
            onDragOver() {
              return undefined;
            },
            onDragEnd() {
              return undefined;
            },
            onDragCancel() {
              return undefined;
            },
          },
        }}
      >
        <SortableContext items={dndIds} strategy={verticalListSortingStrategy}>
          <SidebarStack>
            {sidebarItems.map((item) => {
              if (typeof item === 'object') {
                if (openedFolder.has(item.id)) {
                  return (
                    <OpenedSpaceFolder
                      key={item.id}
                      folder={item}
                      onClose={handleFolderToggle}
                      dropInstruction={dropInstruction}
                    >
                      {item.content.map((sId) => {
                        const space = mx.getRoom(sId);
                        if (!space) return null;
                        return (
                          <SpaceTab
                            key={space.roomId}
                            space={space}
                            selected={space.roomId === selectedSpaceId}
                            onClick={handleSpaceClick}
                            folder={item}
                            dropInstruction={dropInstruction}
                            disabled={
                              typeof draggingItem === 'object'
                                ? draggingItem.spaceId === space.roomId
                                : false
                            }
                            onUnpin={orphanSpaces.includes(space.roomId) ? undefined : handleUnpin}
                          />
                        );
                      })}
                    </OpenedSpaceFolder>
                  );
                }

                return (
                  <ClosedSpaceFolder
                    key={item.id}
                    folder={item}
                    selected={!!selectedSpaceId && item.content.includes(selectedSpaceId)}
                    onOpen={handleFolderToggle}
                    dropInstruction={dropInstruction}
                    disabled={
                      typeof draggingItem === 'object' ? draggingItem.folder.id === item.id : false
                    }
                  />
                );
              }

              const space = mx.getRoom(item);
              if (!space) return null;

              return (
                <SpaceTab
                  key={space.roomId}
                  space={space}
                  selected={space.roomId === selectedSpaceId}
                  onClick={handleSpaceClick}
                  dropInstruction={dropInstruction}
                  disabled={
                    typeof draggingItem === 'string' ? draggingItem === space.roomId : false
                  }
                  onUnpin={orphanSpaces.includes(space.roomId) ? undefined : handleUnpin}
                />
              );
            })}
          </SidebarStack>
        </SortableContext>
        <DragOverlay dropAnimation={null}>{null}</DragOverlay>
      </DndContext>
    </>
  );
}
