import React, { MouseEventHandler, forwardRef, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { factoryRoomIdByAtoZ } from '../../../utils/sort';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import {
  encodeSearchParamValueArray,
  getExplorePath,
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import { useHomeRooms } from './useHomeRooms';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { stopPropagation } from '../../../utils/keyboard';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { _RoomSearchParams } from '../../paths';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import {
  makeNavScrollMemoryKey,
  useNavVirtualizer,
} from '../../../mindroom/sidebar/navScrollMemory';

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const orphanRooms = useVisibleRooms(useHomeRooms());

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MindroomMarkRoomsReadMenuItem roomIds={orphanRooms} onClose={requestClose} />
      </Box>
    </Menu>
  );
});

function HomeHeader() {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              {t('nav.home')}
            </Text>
          </Box>
          <Box>
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
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
            <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeEmpty() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Hash} />}
        title={
          <Text size="H5" align="Center">
            {t('nav.noRooms')}
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            {t('nav.noRoomsDescription')}
          </Text>
        }
        options={
          <UseStateProvider initial={false}>
            {(joinPromptOpen, setJoinPromptOpen) => (
              <>
                <Button
                  onClick={() => navigate(getHomeCreatePath())}
                  variant="Secondary"
                  size="300"
                  data-home-room-action="create"
                  fill="Soft"
                  outlined
                  radii="300"
                >
                  <Text size="B300" truncate>
                    {t('nav.createRoom')}
                  </Text>
                </Button>
                <Button
                  onClick={() => setJoinPromptOpen(true)}
                  variant="Secondary"
                  fill="Soft"
                  size="300"
                  data-home-room-action="join"
                  outlined
                  radii="300"
                >
                  <Text size="B300" truncate>
                    {t('nav.joinWithAddress')}
                  </Text>
                </Button>
                <Button
                  onClick={() => navigate(getExplorePath())}
                  variant="Secondary"
                  fill="Soft"
                  size="300"
                  outlined
                  radii="300"
                >
                  <Text size="B300" truncate>
                    {t('nav.exploreCommunityRooms')}
                  </Text>
                </Button>
                {joinPromptOpen && (
                  <JoinAddressPrompt
                    onCancel={() => setJoinPromptOpen(false)}
                    onOpen={(roomIdOrAlias, viaServers, eventId) => {
                      setJoinPromptOpen(false);
                      const path = getHomeRoomPath(roomIdOrAlias, eventId);
                      navigate(
                        viaServers
                          ? withSearchParam<_RoomSearchParams>(path, {
                              viaServers: encodeSearchParamValueArray(viaServers),
                            })
                          : path
                      );
                    }}
                  />
                )}
              </>
            )}
          </UseStateProvider>
        }
      />
    </NavEmptyCenter>
  );
}

const DEFAULT_CATEGORY_ID = makeNavCategoryId('home', 'room');
export function Home() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollMemoryKey = makeNavScrollMemoryKey(mx.getSafeUserId(), 'home');
  const rooms = useVisibleRooms(useHomeRooms());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const navigate = useNavigate();

  const selectedRoomId = useSelectedRoom();
  const createRoomSelected = useHomeCreateSelected();
  const searchSelected = useHomeSearchSelected();
  const noRoomToDisplay = rooms.length === 0;
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());

  const sortedRooms = useMemo(() => {
    if (closedCategories.has(DEFAULT_CATEGORY_ID)) return [];
    return Array.from(rooms).sort(factoryRoomIdByAtoZ(mx));
  }, [mx, rooms, closedCategories]);

  const virtualizer = useNavVirtualizer(scrollMemoryKey, {
    count: sortedRooms.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  return (
    <PageNav>
      <PageNavContent scrollRef={scrollRef} header={<HomeHeader />}>
        {noRoomToDisplay ? (
          <HomeEmpty />
        ) : (
          <Box direction="Column" gap="300">
            <NavCategory>
              <NavItem variant="Background" radii="400" aria-selected={createRoomSelected}>
                <NavButton
                  onClick={() => navigate(getHomeCreatePath())}
                  data-home-room-action="create"
                >
                  <NavItemContent>
                    <Box as="span" grow="Yes" alignItems="Center" gap="200">
                      <Avatar size="200" radii="400">
                        <Icon src={Icons.Plus} size="100" />
                      </Avatar>
                      <Box as="span" grow="Yes">
                        <Text as="span" size="Inherit" truncate>
                          {t('nav.createRoom')}
                        </Text>
                      </Box>
                    </Box>
                  </NavItemContent>
                </NavButton>
              </NavItem>
              <UseStateProvider initial={false}>
                {(open, setOpen) => (
                  <>
                    <NavItem variant="Background" radii="400">
                      <NavButton onClick={() => setOpen(true)} data-home-room-action="join">
                        <NavItemContent>
                          <Box as="span" grow="Yes" alignItems="Center" gap="200">
                            <Avatar size="200" radii="400">
                              <Icon src={Icons.Link} size="100" />
                            </Avatar>
                            <Box as="span" grow="Yes">
                              <Text as="span" size="Inherit" truncate>
                                {t('nav.joinWithAddress')}
                              </Text>
                            </Box>
                          </Box>
                        </NavItemContent>
                      </NavButton>
                    </NavItem>
                    {open && (
                      <JoinAddressPrompt
                        onCancel={() => setOpen(false)}
                        onOpen={(roomIdOrAlias, viaServers, eventId) => {
                          setOpen(false);
                          const path = getHomeRoomPath(roomIdOrAlias, eventId);
                          navigate(
                            viaServers
                              ? withSearchParam<_RoomSearchParams>(path, {
                                  viaServers: encodeSearchParamValueArray(viaServers),
                                })
                              : path
                          );
                        }}
                      />
                    )}
                  </>
                )}
              </UseStateProvider>
              <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
                <NavLink to={getHomeSearchPath()}>
                  <NavItemContent>
                    <Box as="span" grow="Yes" alignItems="Center" gap="200">
                      <Avatar size="200" radii="400">
                        <Icon src={Icons.Search} size="100" filled={searchSelected} />
                      </Avatar>
                      <Box as="span" grow="Yes">
                        <Text as="span" size="Inherit" truncate>
                          {t('nav.messageSearch')}
                        </Text>
                      </Box>
                    </Box>
                  </NavItemContent>
                </NavLink>
              </NavItem>
            </NavCategory>
            <NavCategory data-testid="room-nav-category">
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={closedCategories.has(DEFAULT_CATEGORY_ID)}
                  data-category-id={DEFAULT_CATEGORY_ID}
                  onClick={handleCategoryClick}
                >
                  {t('nav.rooms')}
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              <div
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const roomId = sortedRooms[vItem.index];
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  const selected = selectedRoomId === roomId;

                  return (
                    <VirtualTile
                      virtualItem={vItem}
                      key={vItem.index}
                      ref={virtualizer.measureElement}
                    >
                      <RoomNavItem
                        room={room}
                        selected={selected}
                        linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(
                          notificationPreferences,
                          room.roomId
                        )}
                      />
                    </VirtualTile>
                  );
                })}
              </div>
            </NavCategory>
            <ThreadNavCategory />
          </Box>
        )}
      </PageNavContent>
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
