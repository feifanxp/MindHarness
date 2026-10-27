import { useTranslation } from 'react-i18next';
import React, {
  MouseEventHandler,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Line,
  PopOut,
  RectCords,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import {
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { JoinRule, Room } from 'matrix-js-sdk';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import FocusTrap from 'focus-trap-react';
import { Menu, MenuItem } from '../../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import {
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import { getSpaceLobbyPath, getSpaceRoomPath, getSpaceSearchPath } from '../../pathUtils';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useSpaceLobbySelected,
  useSpaceSearchSelected,
} from '../../../hooks/router/useSelectedSpace';
import { useSpace } from '../../../hooks/useSpace';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryButton } from '../../../features/room-nav';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useRoomName } from '../../../hooks/useRoomMeta';
import {
  HierarchyItem,
  HierarchyItemRoom,
  HierarchyItemSpace,
  useSpaceJoinedHierarchy,
} from '../../../hooks/useSpaceHierarchy';
import { navigationRoomsAtom } from '../../../mindroom/rooms/archivedRooms';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRecursiveChildScopeFactory, useSpaceChildren } from '../../../state/hooks/roomList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { LeaveSpacePrompt } from '../../../components/leave-space-prompt';
import { copyToClipboard } from '../../../utils/dom';
import { suppressNextClickDefaultAfterPointerDrag } from '../../../utils/sortableDrag';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { Membership, StateEvent } from '../../../../types/matrix/room';
import { stopPropagation } from '../../../utils/keyboard';
import { getMatrixToRoom } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { useOpenSpaceSettings } from '../../../state/hooks/spaceSettings';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { ContainerColor } from '../../../styles/ContainerColor.css';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { BreakWord } from '../../../styles/Text.css';
import { InviteUserPrompt } from '../../../components/invite-user-prompt';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import {
  makeNavScrollMemoryKey,
  useNavVirtualizer,
} from '../../../mindroom/sidebar/navScrollMemory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { useRoomOrderBySpaceAtom } from '../../../state/hooks/sidebarOrder';
import { applyOrderOverride } from '../../../state/utils/applyOrderOverride';
import {
  makeRoomSortableId,
  parseRoomSortableId,
  SortableRoomNavItem,
  SortableRoomNavItemData,
} from '../../../features/room-nav/SortableRoomNavItem';

type SpaceMenuProps = {
  room: Room;
  requestClose: () => void;
  onSpaceRemoved: () => void;
};
const SpaceMenu = forwardRef<HTMLDivElement, SpaceMenuProps>(
  ({ room, requestClose, onSpaceRemoved }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const [developerTools] = useSetting(settingsAtom, 'developerTools');
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevels(room);
    const creators = useRoomCreators(room);

    const permissions = useRoomPermissions(creators, powerLevels);
    const canInvite = permissions.action('invite', mx.getSafeUserId());
    const openSpaceSettings = useOpenSpaceSettings();
    const { navigateRoom } = useRoomNavigate();

    const [invitePrompt, setInvitePrompt] = useState(false);

    const allChild = useSpaceChildren(
      navigationRoomsAtom,
      room.roomId,
      useRecursiveChildScopeFactory(mx, roomToParents)
    );

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

    const handleOpenTimeline = () => {
      navigateRoom(room.roomId);
      requestClose();
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          {invitePrompt && room && (
            <InviteUserPrompt
              room={room}
              requestClose={() => {
                setInvitePrompt(false);
                requestClose();
              }}
            />
          )}
          <MindroomMarkRoomsReadMenuItem roomIds={allChild} onClose={requestClose} />
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
              {t('sharedUi.space.invite')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleCopyLink}
            size="300"
            after={<Icon size="100" src={Icons.Link} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('sharedUi.space.copyLink')}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleRoomSettings}
            size="300"
            after={<Icon size="100" src={Icons.Setting} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('sharedUi.space.spaceSettings')}
            </Text>
          </MenuItem>
          {developerTools && (
            <MenuItem
              onClick={handleOpenTimeline}
              size="300"
              after={<Icon size="100" src={Icons.Terminal} />}
              radii="300"
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                {t('sharedUi.space.eventTimeline')}
              </Text>
            </MenuItem>
          )}
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <UseStateProvider initial={false}>
            {(promptLeave, setPromptLeave) => (
              <>
                <MenuItem
                  onClick={() => setPromptLeave(true)}
                  variant="Critical"
                  fill="None"
                  size="300"
                  after={<Icon size="100" src={Icons.ArrowGoLeft} />}
                  radii="300"
                  aria-pressed={promptLeave}
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    {t('sharedUi.space.leaveSpace')}
                  </Text>
                </MenuItem>
                {promptLeave && (
                  <LeaveSpacePrompt
                    roomId={room.roomId}
                    onDone={() => {
                      onSpaceRemoved();
                      requestClose();
                    }}
                    onCancel={() => setPromptLeave(false)}
                  />
                )}
              </>
            )}
          </UseStateProvider>
        </Box>
      </Menu>
    );
  }
);

const isHierarchySpace = (item: HierarchyItem): item is HierarchyItemSpace => 'space' in item;
const isHierarchyRoom = (item: HierarchyItem): item is HierarchyItemRoom => !isHierarchySpace(item);

const applyRoomOrderBySpace = (
  hierarchy: HierarchyItem[],
  roomOrderBySpace: Record<string, string[]>,
  expandedParentSpace: (parentSpaceId: string) => boolean
): HierarchyItem[] => {
  const orderedHierarchy: HierarchyItem[] = [];

  for (let index = 0; index < hierarchy.length; index += 1) {
    const item = hierarchy[index];
    if (isHierarchyRoom(item)) {
      orderedHierarchy.push(item);
      continue;
    }

    orderedHierarchy.push(item);
    const roomItems: HierarchyItemRoom[] = [];
    while (index + 1 < hierarchy.length && isHierarchyRoom(hierarchy[index + 1])) {
      roomItems.push(hierarchy[index + 1] as HierarchyItemRoom);
      index += 1;
    }

    if (roomItems.length === 0 || !expandedParentSpace(item.roomId)) {
      orderedHierarchy.push(...roomItems);
      continue;
    }

    const roomById = new Map(roomItems.map((roomItem) => [roomItem.roomId, roomItem]));
    const orderedRoomIds = applyOrderOverride(
      roomItems.map((roomItem) => roomItem.roomId),
      roomOrderBySpace[item.roomId] ?? []
    );
    orderedHierarchy.push(...orderedRoomIds.map((roomId) => roomById.get(roomId)!));
  }

  return orderedHierarchy;
};

function SpaceHeader() {
  const space = useSpace();
  const spaceName = useRoomName(space);
  const [, setRoomOrderBySpace] = useAtom(useRoomOrderBySpaceAtom());
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const joinRules = useStateEvent(
    space,
    StateEvent.RoomJoinRules
  )?.getContent<RoomJoinRulesEventContent>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  const handleSpaceRemoved = useCallback(() => {
    setRoomOrderBySpace({ type: 'REMOVE_SPACE', parentSpaceId: space.roomId });
  }, [setRoomOrderBySpace, space.roomId]);

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes" alignItems="Center" gap="100">
            <Text size="H4" truncate>
              {spaceName}
            </Text>
            {joinRules?.join_rule !== JoinRule.Public && <Icon src={Icons.Lock} size="50" />}
          </Box>
          <Box shrink="No">
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      {menuAnchor && (
        <PopOut
          anchor={menuAnchor}
          position="Bottom"
          align="End"
          offset={6}
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
                onSpaceRemoved={handleSpaceRemoved}
              />
            </FocusTrap>
          }
        />
      )}
    </>
  );
}

type SpaceTombstoneProps = { roomId: string; replacementRoomId: string };
export function SpaceTombstone({ roomId, replacementRoomId }: SpaceTombstoneProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { navigateSpace } = useRoomNavigate();

  const [joinState, handleJoin] = useAsyncCallback(
    useCallback(() => {
      const currentRoom = mx.getRoom(roomId);
      const via = currentRoom ? getViaServers(currentRoom) : [];
      return mx.joinRoom(replacementRoomId, {
        viaServers: via,
      });
    }, [mx, roomId, replacementRoomId])
  );
  const replacementRoom = mx.getRoom(replacementRoomId);

  const handleOpen = () => {
    if (replacementRoom) navigateSpace(replacementRoom.roomId);
    if (joinState.status === AsyncStatus.Success) navigateSpace(joinState.data.roomId);
  };

  return (
    <Box
      style={{
        padding: config.space.S200,
        borderRadius: config.radii.R400,
        borderWidth: config.borderWidth.B300,
      }}
      className={ContainerColor({ variant: 'Surface' })}
      direction="Column"
      gap="300"
    >
      <Box direction="Column" grow="Yes" gap="100">
        <Text size="L400">{t('sharedUi.space.spaceUpgraded')}</Text>
        <Text size="T200">{t('sharedUi.space.thisSpaceHasBeenReplacedAndIsNoLongerActive')}</Text>
        {joinState.status === AsyncStatus.Error && (
          <Text className={BreakWord} style={{ color: color.Critical.Main }} size="T200">
            {(joinState.error as any)?.message ?? t('sharedUi.space.failedToJoinReplacementSpace')}
          </Text>
        )}
      </Box>
      <Box direction="Column" shrink="No">
        {replacementRoom?.getMyMembership() === Membership.Join ||
        joinState.status === AsyncStatus.Success ? (
          <Button
            onClick={handleOpen}
            size="300"
            variant="Success"
            fill="Soft"
            radii="300"
            outlined
          >
            <Text size="B300">{t('sharedUi.space.openNewSpace')}</Text>
          </Button>
        ) : (
          <Button
            onClick={handleJoin}
            size="300"
            variant="Primary"
            fill="Soft"
            radii="300"
            before={
              joinState.status === AsyncStatus.Loading && (
                <Spinner size="100" variant="Primary" fill="Soft" />
              )
            }
            disabled={joinState.status === AsyncStatus.Loading}
            outlined
          >
            <Text size="B300">{t('sharedUi.space.joinNewSpace')}</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function Space() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const space = useSpace();
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollMemoryKey = makeNavScrollMemoryKey(mx.getSafeUserId(), space.roomId);
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useAtomValue(navigationRoomsAtom);
  const allJoinedRooms = useMemo(() => new Set(allRooms), [allRooms]);
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const [roomOrderBySpace, setRoomOrderBySpace] = useAtom(useRoomOrderBySpaceAtom());

  const tombstoneEvent = useStateEvent(space, StateEvent.RoomTombstone);
  const selectedRoomId = useSelectedRoom();
  const lobbySelected = useSpaceLobbySelected(spaceIdOrAlias);
  const searchSelected = useSpaceSearchSelected(spaceIdOrAlias);

  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());

  const getRoom = useCallback(
    (rId: string): Room | undefined => {
      if (allJoinedRooms.has(rId)) {
        return mx.getRoom(rId) ?? undefined;
      }
      return undefined;
    },
    [mx, allJoinedRooms]
  );

  const hierarchy = useSpaceJoinedHierarchy(
    space.roomId,
    getRoom,
    useCallback(
      (parentId) => closedCategories.has(makeNavCategoryId(space.roomId, parentId)),
      [space.roomId, closedCategories]
    ),
    useCallback(
      (sId) => closedCategories.has(makeNavCategoryId(space.roomId, sId)),
      [closedCategories, space.roomId]
    )
  );

  const isCategoryExpanded = useCallback(
    (parentSpaceId: string) =>
      !closedCategories.has(makeNavCategoryId(space.roomId, parentSpaceId)),
    [closedCategories, space.roomId]
  );
  const orderedHierarchy = useMemo(
    () => applyRoomOrderBySpace(hierarchy, roomOrderBySpace, isCategoryExpanded),
    [hierarchy, roomOrderBySpace, isCategoryExpanded]
  );
  const roomDndIdsByParentSpace = useMemo(
    () =>
      orderedHierarchy.reduce((itemsByParentSpace, item) => {
        if (isHierarchyRoom(item)) {
          const parentItems = itemsByParentSpace.get(item.parentId) ?? [];
          parentItems.push(makeRoomSortableId(item.parentId, item.roomId));
          itemsByParentSpace.set(item.parentId, parentItems);
        }
        return itemsByParentSpace;
      }, new Map<string, string[]>()),
    [orderedHierarchy]
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const virtualizer = useNavVirtualizer(scrollMemoryKey, {
    count: orderedHierarchy.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 0,
    overscan: 10,
  });

  useEffect(() => {
    if (tombstoneEvent) {
      setRoomOrderBySpace({ type: 'REMOVE_SPACE', parentSpaceId: space.roomId });
    }
  }, [setRoomOrderBySpace, space.roomId, tombstoneEvent]);

  const handleRoomDragEnd = useCallback(
    (event: DragEndEvent) => {
      suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
      if (!event.over || event.active.id === event.over.id) return;

      const activeData = parseRoomSortableId(event.active.id.toString());
      const overData = parseRoomSortableId(event.over.id.toString());
      if (!activeData || !overData) return;
      if (activeData.parentSpaceId !== overData.parentSpaceId) return;
      if (!isCategoryExpanded(activeData.parentSpaceId)) return;

      const roomIds = orderedHierarchy
        .filter(
          (item): item is HierarchyItemRoom =>
            isHierarchyRoom(item) && item.parentId === activeData.parentSpaceId
        )
        .map((item) => item.roomId);
      const oldIndex = roomIds.indexOf(activeData.roomId);
      const newIndex = roomIds.indexOf(overData.roomId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      setRoomOrderBySpace({
        type: 'REORDER',
        parentSpaceId: activeData.parentSpaceId,
        order: arrayMove(roomIds, oldIndex, newIndex),
      });
    },
    [isCategoryExpanded, orderedHierarchy, setRoomOrderBySpace]
  );
  const handleRoomDragCancel = useCallback((event: DragCancelEvent) => {
    suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
  }, []);

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  const getToLink = (roomId: string) =>
    getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(mx, roomId));

  return (
    <PageNav>
      <PageNavContent scrollRef={scrollRef} header={<SpaceHeader />}>
        <Box direction="Column" gap="300">
          {tombstoneEvent && (
            <SpaceTombstone
              roomId={space.roomId}
              replacementRoomId={tombstoneEvent.getContent().replacement_room}
            />
          )}
          <NavCategory>
            <NavItem variant="Background" radii="400" aria-selected={lobbySelected}>
              <NavLink to={getSpaceLobbyPath(getCanonicalAliasOrRoomId(mx, space.roomId))}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Flag} size="100" filled={lobbySelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        {t('sharedUi.space.lobby')}
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
            <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
              <NavLink to={getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId))}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Search} size="100" filled={searchSelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        {t('sharedUi.space.messageSearch')}
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
          </NavCategory>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleRoomDragEnd}
            onDragCancel={handleRoomDragCancel}
            accessibility={{
              announcements: {
                onDragStart({ active }) {
                  const activeData = active.data.current as SortableRoomNavItemData | undefined;
                  const roomId =
                    activeData?.roomId ??
                    parseRoomSortableId(active.id.toString())?.roomId ??
                    active.id.toString();
                  const label = mx.getRoom(roomId)?.name ?? roomId;
                  return t('sharedUi.space.pickedUpRoomValue1UseArrowKeysToReorderPressSpaceTo', {
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
            <NavCategory
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {(() => {
                const nonRoomTiles: React.ReactNode[] = [];
                const roomTilesByParentSpace = new Map<string, React.ReactNode[]>();

                virtualizer.getVirtualItems().forEach((vItem) => {
                  const hierarchyItem = orderedHierarchy[vItem.index];
                  const { roomId } = hierarchyItem ?? {};
                  const room = mx.getRoom(roomId);
                  if (!room || !hierarchyItem) return;

                  if (room.isSpaceRoom()) {
                    const categoryId = makeNavCategoryId(space.roomId, roomId);

                    nonRoomTiles.push(
                      <VirtualTile
                        virtualItem={vItem}
                        key={vItem.index}
                        ref={virtualizer.measureElement}
                      >
                        <div
                          style={{
                            paddingTop: vItem.index === 0 ? undefined : config.space.S400,
                          }}
                        >
                          <NavCategoryHeader>
                            <RoomNavCategoryButton
                              data-category-id={categoryId}
                              onClick={handleCategoryClick}
                              closed={closedCategories.has(categoryId)}
                            >
                              {roomId === space.roomId ? t('sharedUi.space.rooms') : room?.name}
                            </RoomNavCategoryButton>
                          </NavCategoryHeader>
                        </div>
                      </VirtualTile>
                    );
                    return;
                  }

                  if (!isHierarchyRoom(hierarchyItem)) return;

                  const roomTiles = roomTilesByParentSpace.get(hierarchyItem.parentId) ?? [];
                  roomTiles.push(
                    <VirtualTile
                      virtualItem={vItem}
                      key={vItem.index}
                      ref={virtualizer.measureElement}
                    >
                      <SortableRoomNavItem
                        parentSpaceId={hierarchyItem.parentId}
                        room={room}
                        selected={selectedRoomId === roomId}
                        showAvatar={mDirects.has(roomId)}
                        direct={mDirects.has(roomId)}
                        linkPath={getToLink(roomId)}
                        notificationMode={getRoomNotificationMode(
                          notificationPreferences,
                          room.roomId
                        )}
                      />
                    </VirtualTile>
                  );
                  roomTilesByParentSpace.set(hierarchyItem.parentId, roomTiles);
                });

                return (
                  <>
                    {nonRoomTiles}
                    {Array.from(roomTilesByParentSpace, ([parentSpaceId, roomTiles]) => (
                      <SortableContext
                        key={parentSpaceId}
                        items={roomDndIdsByParentSpace.get(parentSpaceId) ?? []}
                        strategy={verticalListSortingStrategy}
                      >
                        {roomTiles}
                      </SortableContext>
                    ))}
                  </>
                );
              })()}
            </NavCategory>
          </DndContext>
          <ThreadNavCategory spaceId={space.roomId} />
        </Box>
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
