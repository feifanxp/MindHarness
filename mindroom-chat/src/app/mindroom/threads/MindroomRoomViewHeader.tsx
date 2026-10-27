import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import React, { MouseEventHandler, forwardRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Avatar,
  Text,
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  IconButton,
  Icon,
  Icons,
  type IconSrc,
  Tooltip,
  TooltipProvider,
  toRem,
  config,
  Line,
  PopOut,
  RectCords,
  Badge,
  Spinner,
} from 'folds';
import { useNavigate } from 'react-router-dom';
import { Room } from 'matrix-js-sdk';
import { ArchiveRoomMenuItem } from '../rooms/ArchiveRoomMenuItem';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useStateEvent } from '../../hooks/useStateEvent';
import { glassFlat, glassFloating, glassSurface } from '../../styles/Glass.css';
import { PageHeader } from '../../components/page';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UseStateProvider } from '../../components/UseStateProvider';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { getHomeSearchPath, getSpaceSearchPath, withSearchParam } from '../../pages/pathUtils';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../../utils/matrix';
import { _SearchPathSearchParams } from '../../pages/paths';
import * as css from '../../features/room/RoomViewHeader.css';
import * as headerCss from './MindroomRoomViewHeader.css';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { MindroomMarkRoomReadMenuItem } from '../notifications/MindroomMarkRoomReadMenuItem';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';
import { copyToClipboard } from '../../utils/dom';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { MindroomBackRouteHandler as BackRouteHandler } from '../native/MindroomBackRouteHandler';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { RoomPinMenu } from '../messages/MindroomRoomPinMenu';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { RoomSchedulesButton } from '../schedules/RoomSchedulesButton';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { JumpToTime } from '../../features/room/jump-to-time';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { RoomSettingsPage } from '../../state/roomSettings';
import type { RoomViewMode } from './roomViewMode';
import { useRoomViewMode } from './useRoomViewMode';
import {
  getPendingJoinRequestLabel,
  PendingJoinRequestBadge,
} from '../../features/room/PendingJoinRequestBadge';
import { ComputerHeaderButton } from '../computer/ComputerHeaderButton';
import { CanvasHeaderButton } from '../canvas/CanvasHeaderButton';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import { AgentCallHeaderButton } from '../calls/AgentCallHeaderButton';

const ROOM_VIEW_MODE_MENU_ITEMS = {
  compact: { icon: Icons.Category, label: 'mindroomUi.threads.mindroomRoomViewHeader.compact' },
  threaded: { icon: Icons.Thread, label: 'mindroomUi.threads.mindroomRoomViewHeader.threads' },
  classic: { icon: Icons.Message, label: 'mindroomUi.threads.mindroomRoomViewHeader.classic' },
} as const satisfies Record<RoomViewMode, { icon: IconSrc; label: string }>;

type RoomMenuProps = {
  room: Room;
  requestClose: () => void;
  // Server-side search cannot read encrypted rooms, so the header leaves this out there.
  onSearchMessages?: () => void;
  // Set while the header's Computer button is hidden, so the computer stays one click away.
  onShowComputer?: () => void;
};
const RoomMenu = forwardRef<HTMLDivElement, RoomMenuProps>((props, ref) => {
  const { room, requestClose, onSearchMessages, onShowComputer } = props;
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canInvite = permissions.action('invite', mx.getSafeUserId());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const notificationMode = getRoomNotificationMode(notificationPreferences, room.roomId);
  const { navigateRoom } = useRoomNavigate();
  const { availableViewModes, setViewMode, viewMode } = useRoomViewMode(room.roomId);
  const simpleMode = useSimpleMode();

  const [invitePrompt, setInvitePrompt] = useState(false);

  const handleInvite = () => {
    setInvitePrompt(true);
  };

  const handleCopyLink = () => {
    const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
    const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
    copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
    requestClose();
  };

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleOpenSettings = () => {
    openSettings(room.roomId, parentSpace?.roomId);
    requestClose();
  };

  const handleViewMode = (mode: RoomViewMode) => {
    setViewMode(mode);
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(200), width: '100vw' }}>
      {invitePrompt && (
        <InviteUserPrompt
          room={room}
          requestClose={() => {
            setInvitePrompt(false);
            requestClose();
          }}
        />
      )}
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
        <RoomNotificationModeSwitcher roomId={room.roomId} value={notificationMode}>
          {(handleOpen, opened, changing) => (
            <MenuItem
              size="300"
              after={
                changing ? (
                  <Spinner size="100" variant="Secondary" />
                ) : (
                  <Icon size="100" src={getRoomNotificationModeIcon(notificationMode)} />
                )
              }
              radii="300"
              aria-pressed={opened}
              onClick={handleOpen}
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                {t('mindroomUi.threads.mindroomRoomViewHeader.notifications')}
              </Text>
            </MenuItem>
          )}
        </RoomNotificationModeSwitcher>
      </Box>
      {availableViewModes.length > 0 && (
        <>
          <Line variant="Surface" size="300" />
          <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
            {availableViewModes.map((mode) => (
              <MenuItem
                key={mode}
                onClick={() => handleViewMode(mode)}
                size="300"
                after={<Icon size="100" src={ROOM_VIEW_MODE_MENU_ITEMS[mode].icon} />}
                radii="300"
                aria-pressed={viewMode === mode}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {t(ROOM_VIEW_MODE_MENU_ITEMS[mode].label)}
                </Text>
              </MenuItem>
            ))}
          </Box>
        </>
      )}
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
            {t('mindroomUi.threads.mindroomRoomViewHeader.invite')}
          </Text>
        </MenuItem>
        {onShowComputer && (
          <MenuItem
            onClick={() => {
              onShowComputer();
              requestClose();
            }}
            size="300"
            after={<Icon size="100" src={Icons.Monitor} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('mindroomUi.threads.mindroomRoomViewHeader.showComputer')}
            </Text>
          </MenuItem>
        )}
        {!simpleMode && (
          <>
            {onSearchMessages && (
              <MenuItem
                onClick={() => {
                  onSearchMessages();
                  requestClose();
                }}
                size="300"
                after={<Icon size="100" src={Icons.Search} />}
                radii="300"
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {t('nav.messageSearch')}
                </Text>
              </MenuItem>
            )}
            <MenuItem
              onClick={handleCopyLink}
              size="300"
              after={<Icon size="100" src={Icons.Link} />}
              radii="300"
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                {t('mindroomUi.threads.mindroomRoomViewHeader.copyLink')}
              </Text>
            </MenuItem>
            <MenuItem
              onClick={handleOpenSettings}
              size="300"
              after={<Icon size="100" src={Icons.Setting} />}
              radii="300"
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                {t('mindroomUi.threads.mindroomRoomViewHeader.roomSettings')}
              </Text>
            </MenuItem>
            <UseStateProvider initial={false}>
              {(promptJump, setPromptJump) => (
                <>
                  <MenuItem
                    onClick={() => setPromptJump(true)}
                    size="300"
                    after={<Icon size="100" src={Icons.RecentClock} />}
                    radii="300"
                    aria-pressed={promptJump}
                  >
                    <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                      {t('mindroomUi.threads.mindroomRoomViewHeader.jumpToTime')}
                    </Text>
                  </MenuItem>
                  {promptJump && (
                    <JumpToTime
                      onSubmit={(eventId) => {
                        setPromptJump(false);
                        navigateRoom(room.roomId, eventId);
                        requestClose();
                      }}
                      onCancel={() => setPromptJump(false)}
                    />
                  )}
                </>
              )}
            </UseStateProvider>
          </>
        )}
      </Box>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {!room.isSpaceRoom() && <ArchiveRoomMenuItem roomId={room.roomId} onClose={requestClose} />}
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
                  {t('mindroomUi.threads.mindroomRoomViewHeader.leaveRoom')}
                </Text>
              </MenuItem>
              {promptLeave && (
                <LeaveRoomPrompt
                  roomId={room.roomId}
                  onDone={requestClose}
                  onCancel={() => setPromptLeave(false)}
                />
              )}
            </>
          )}
        </UseStateProvider>
      </Box>
    </Menu>
  );
});

export function RoomViewHeader({
  callView,
  hasMindroomAgents,
  computerAvailable = false,
  computerOpen = false,
  computerShown = false,
  onComputerToggle,
  canvasOpen = false,
  canvases,
  openCanvasId,
  onCanvasOpen,
  onCanvasClose,
  threadId,
  joinRequestCount = 0,
}: {
  callView?: boolean;
  hasMindroomAgents: boolean;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  /** An agent showed its computer in this conversation; until then the room menu opens it. */
  computerShown?: boolean;
  onComputerToggle?: () => void;
  /** A canvas holds the side panel slot, so Members shows as closed and opening it replaces the canvas. */
  canvasOpen?: boolean;
  /** The conversation's canvases; the button shows only when there are some. */
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
  threadId?: string;
  joinRequestCount?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const screenSize = useScreenSizeContext();
  const room = useRoom();
  const { navigateRoomThread } = useRoomNavigate();
  const space = useSpaceOptionally();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinMenuAnchor, setPinMenuAnchor] = useState<RectCords>();
  const direct = useIsDirectRoom();
  const simpleMode = useSimpleMode();

  const pinnedEvents = useRoomPinnedEvents(room);
  const encryptionEvent = useStateEvent(room, StateEvent.RoomEncryption);
  const encryptedRoom = !!encryptionEvent;
  const avatarMxc = useRoomAvatar(room, direct);
  const name = useRoomName(room);
  const topic = useRoomTopic(room);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const myUserId = mx.getSafeUserId();
  const canReviewJoinRequests =
    permissions.action('invite', myUserId) || permissions.action('kick', myUserId);
  const visibleJoinRequestCount = canReviewJoinRequests ? joinRequestCount : 0;
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const [peopleDrawer, setPeopleDrawer] = useMembersDrawer();
  const membersOpen = peopleDrawer && !computerOpen && !canvasOpen;

  const handleSearchClick = () => {
    const searchParams: _SearchPathSearchParams = {
      rooms: room.roomId,
    };
    const path = space
      ? getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId))
      : getHomeSearchPath();
    navigate(withSearchParam(path, searchParams));
  };

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleOpenPinMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setPinMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleMemberToggle = () => {
    if (callView) {
      openSettings(room.roomId, parentSpace?.roomId, RoomSettingsPage.MembersPage);
      return;
    }
    if (computerOpen) onComputerToggle?.();
    if (canvasOpen) onCanvasClose?.();
    setPeopleDrawer(!membersOpen);
  };
  // The button follows the computer's use; before then the room menu opens it. A phone's header fits
  // six actions and the Canvas button is one more, so there the menu always opens the computer.
  const computerReachable = computerAvailable && !!onComputerToggle;
  const computerButtonShown =
    computerReachable && screenSize !== ScreenSize.Mobile && (computerOpen || computerShown);
  const computerMenuItemShown = computerReachable && !computerButtonShown;
  const memberButtonLabel = callView
    ? t('mindroomUi.threads.mindroomRoomViewHeader.members')
    : membersOpen
    ? t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')
    : t('mindroomUi.threads.mindroomRoomViewHeader.showMembers');
  const memberButtonAriaLabel = getPendingJoinRequestLabel(
    t,
    memberButtonLabel,
    visibleJoinRequestCount
  );

  return (
    <PageHeader
      appearance="plain"
      className={classNames(
        ContainerColor({ variant: 'Surface' }),
        glassSurface({ level: 'panel', variant: 'Surface' }),
        glassFloating,
        glassFlat,
        headerCss.Header
      )}
      balance={screenSize === ScreenSize.Mobile}
    >
      <Box grow="Yes" gap="300">
        {screenSize === ScreenSize.Mobile && (
          <BackRouteHandler enableEdgeSwipe={!threadId}>
            {(onBack) => (
              <Box shrink="No" alignItems="Center">
                {/* Phones only, where there is no hover for a tooltip. */}
                <IconButton
                  fill="None"
                  onClick={onBack}
                  aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
                >
                  <Icon data-directional src={Icons.ArrowLeft} />
                </IconButton>
              </Box>
            )}
          </BackRouteHandler>
        )}
        <Box grow="Yes" alignItems="Center" gap="300">
          {screenSize !== ScreenSize.Mobile && (
            <Avatar size="300">
              <RoomAvatar
                roomId={room.roomId}
                src={avatarUrl}
                alt={name}
                renderFallback={() => (
                  <RoomIcon size="200" joinRule={room.getJoinRule()} roomType={room.getType()} />
                )}
              />
            </Avatar>
          )}
          <Box direction="Column">
            <Text size={topic ? 'H5' : 'H3'} truncate>
              {name}
            </Text>
            {topic && (
              <UseStateProvider initial={false}>
                {(viewTopic, setViewTopic) => (
                  <>
                    <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
                      <OverlayCenter>
                        <FocusTrap
                          focusTrapOptions={{
                            initialFocus: false,
                            clickOutsideDeactivates: true,
                            onDeactivate: () => setViewTopic(false),
                            escapeDeactivates: stopPropagation,
                          }}
                        >
                          <RoomTopicViewer
                            name={name}
                            topic={topic}
                            requestClose={() => setViewTopic(false)}
                          />
                        </FocusTrap>
                      </OverlayCenter>
                    </Overlay>
                    <Text
                      as="button"
                      type="button"
                      onClick={() => setViewTopic(true)}
                      className={classNames(css.HeaderTopic, headerCss.Topic)}
                      size="T200"
                      priority="300"
                      truncate
                    >
                      {topic}
                    </Text>
                  </>
                )}
              </UseStateProvider>
            )}
          </Box>
        </Box>

        <Box shrink="No">
          {hasMindroomAgents && (
            <RoomSchedulesButton
              key={room.roomId}
              room={room}
              onOpenThread={(rootId) => navigateRoomThread(room.roomId, rootId)}
            />
          )}
          <ComputerHeaderButton
            label={t(
              computerOpen
                ? 'mindroomUi.threads.mindroomRoomViewHeader.hideComputer'
                : 'mindroomUi.threads.mindroomRoomViewHeader.showComputer'
            )}
            available={computerButtonShown}
            open={computerOpen}
            onToggle={onComputerToggle ?? (() => undefined)}
          />
          {canvases && onCanvasOpen && onCanvasClose && (
            <CanvasHeaderButton
              canvases={canvases}
              openCanvasId={openCanvasId}
              onOpen={onCanvasOpen}
              onClose={onCanvasClose}
            />
          )}
          {!simpleMode && (
            <>
              <TooltipProvider
                position="Bottom"
                offset={4}
                tooltip={
                  <Tooltip>
                    <Text>{t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages')}</Text>
                  </Tooltip>
                }
              >
                {(triggerRef) => (
                  <IconButton
                    fill="None"
                    style={{ position: 'relative' }}
                    onClick={handleOpenPinMenu}
                    ref={triggerRef}
                    aria-pressed={!!pinMenuAnchor}
                  >
                    {pinnedEvents.length > 0 && (
                      <Badge
                        style={{
                          position: 'absolute',
                          left: toRem(3),
                          top: toRem(3),
                        }}
                        variant="Secondary"
                        size="400"
                        fill="Solid"
                        radii="Pill"
                      >
                        <Text as="span" size="L400">
                          {pinnedEvents.length}
                        </Text>
                      </Badge>
                    )}
                    <Icon size="400" src={Icons.Pin} filled={!!pinMenuAnchor} />
                  </IconButton>
                )}
              </TooltipProvider>
              <PopOut
                anchor={pinMenuAnchor}
                position="Bottom"
                content={
                  <FocusTrap
                    focusTrapOptions={{
                      initialFocus: false,
                      returnFocusOnDeactivate: false,
                      onDeactivate: () => setPinMenuAnchor(undefined),
                      clickOutsideDeactivates: true,
                      isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                      isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                      escapeDeactivates: stopPropagation,
                    }}
                  >
                    <RoomPinMenu room={room} requestClose={() => setPinMenuAnchor(undefined)} />
                  </FocusTrap>
                }
              />
            </>
          )}

          {hasMindroomAgents && !callView && <AgentCallHeaderButton threadId={threadId} />}
          <TooltipProvider
            position="Bottom"
            offset={4}
            tooltip={
              <Tooltip>
                {callView ? (
                  <Text>{t('mindroomUi.threads.mindroomRoomViewHeader.members')}</Text>
                ) : (
                  <Text>
                    {membersOpen
                      ? t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')
                      : t('mindroomUi.threads.mindroomRoomViewHeader.showMembers')}
                  </Text>
                )}
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                style={{ position: 'relative' }}
                ref={triggerRef}
                onClick={handleMemberToggle}
                aria-label={memberButtonAriaLabel}
              >
                {!callView && <PendingJoinRequestBadge count={visibleJoinRequestCount} />}
                <Icon size="400" src={Icons.User} />
              </IconButton>
            )}
          </TooltipProvider>

          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>{t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions')}</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                onClick={handleOpenMenu}
                ref={triggerRef}
                aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions')}
                aria-pressed={!!menuAnchor}
              >
                <Icon size="400" src={Icons.VerticalDots} filled={!!menuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={menuAnchor}
            position="Bottom"
            align="End"
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
                <RoomMenu
                  room={room}
                  requestClose={() => setMenuAnchor(undefined)}
                  onSearchMessages={encryptedRoom ? undefined : handleSearchClick}
                  onShowComputer={computerMenuItemShown ? onComputerToggle : undefined}
                />
              </FocusTrap>
            }
          />
        </Box>
      </Box>
    </PageHeader>
  );
}
