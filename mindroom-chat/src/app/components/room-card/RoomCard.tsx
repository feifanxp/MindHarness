import { useTranslation } from 'react-i18next';
import React, { ReactNode, useCallback, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
  color,
  config,
} from 'folds';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import { Dialog } from '../glass/GlassPrimitives';
import * as css from './style.css';
import { RoomAvatar } from '../room-avatar';
import { getMxIdLocalPart, isRoomId, mxcUrlToHttp } from '../../utils/matrix';
import { nameInitials } from '../../utils/common';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { onEnterOrSpace, stopPropagation } from '../../utils/keyboard';
import { RoomType, StateEvent } from '../../../types/matrix/room';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { getRoomAvatarUrl, getStateEvent } from '../../utils/room';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  RoomAccessControl,
  RoomAccessJoinRule,
  getDiscoveredRoomAccessJoinRule,
  isRoomAccessJoinRule,
} from '../room-access';

type GridColumnCount = '1' | '2' | '3';
const getGridColumnCount = (gridWidth: number): GridColumnCount => {
  if (gridWidth <= 498) return '1';
  if (gridWidth <= 748) return '2';
  return '3';
};

const setGridColumnCount = (grid: HTMLElement, count: GridColumnCount): void => {
  grid.style.setProperty('grid-template-columns', `repeat(${count}, 1fr)`);
};

export function RoomCardGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useElementSizeObserver(
    useCallback(() => gridRef.current, []),
    useCallback((width, _, target) => setGridColumnCount(target, getGridColumnCount(width)), [])
  );

  return (
    <Box className={css.CardGrid} direction="Row" gap="400" wrap="Wrap" ref={gridRef}>
      {children}
    </Box>
  );
}

export const RoomCardBase = as<'div'>(({ className, ...props }, ref) => (
  <Box
    direction="Column"
    gap="300"
    className={classNames(css.RoomCardBase, className)}
    {...props}
    ref={ref}
  />
));

export const RoomCardName = as<'h6'>(({ ...props }, ref) => (
  <Text as="h6" size="H6" truncate {...props} ref={ref} />
));

export const RoomCardTopic = as<'p'>(({ className, ...props }, ref) => (
  <Text
    as="p"
    size="T200"
    className={classNames(css.RoomCardTopic, className)}
    {...props}
    priority="400"
    ref={ref}
  />
));

function ErrorDialog({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children: (openError: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const [viewError, setViewError] = useState(false);
  const closeError = () => setViewError(false);
  const openError = () => setViewError(true);

  return (
    <>
      {children(openError)}
      <Overlay open={viewError} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              clickOutsideDeactivates: true,
              onDeactivate: closeError,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Dialog variant="Surface">
              <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                <Box direction="Column" gap="100">
                  <Text>{title}</Text>
                  <Text style={{ color: color.Critical.Main }} size="T300" priority="400">
                    {message}
                  </Text>
                </Box>
                <Button
                  size="400"
                  variant="Secondary"
                  fill="Soft"
                  onClick={closeError}
                  outlined
                  radii="300"
                >
                  <Text size="B400">{t('sharedUi.roomCard.cancel')}</Text>
                </Button>
              </Box>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </>
  );
}

type RoomCardProps = {
  roomIdOrAlias: string;
  roomId?: string;
  allRooms: string[];
  avatarUrl?: string;
  name?: string;
  topic?: string;
  memberCount?: number;
  roomType?: string;
  joinRule?: RoomAccessJoinRule;
  membership?: string;
  accessStatus?: AsyncStatus;
  onAccessRetry?: () => void;
  viaServers?: string[];
  onView?: (roomId: string) => void;
  renderTopicViewer: (name: string, topic: string, requestClose: () => void) => ReactNode;
};

export const RoomCard = as<'div', RoomCardProps>(
  (
    {
      roomIdOrAlias,
      roomId,
      allRooms,
      avatarUrl,
      name,
      topic,
      memberCount,
      roomType,
      joinRule,
      membership,
      accessStatus,
      onAccessRetry,
      viaServers,
      onView,
      renderTopicViewer,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const targetRoomId = roomId ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : undefined);
    const joinedRoomId = targetRoomId && allRooms.includes(targetRoomId) ? targetRoomId : undefined;
    const joinedRoom = mx.getRoom(joinedRoomId);
    const [topicEvent, setTopicEvent] = useState(() =>
      joinedRoom ? getStateEvent(joinedRoom, StateEvent.RoomTopic) : undefined
    );

    const fallbackName = getMxIdLocalPart(roomIdOrAlias) ?? roomIdOrAlias;
    const fallbackTopic = roomIdOrAlias;

    const avatar = joinedRoom
      ? getRoomAvatarUrl(mx, joinedRoom, 96, useAuthentication)
      : avatarUrl && mxcUrlToHttp(mx, avatarUrl, useAuthentication, 96, 96, 'crop');

    const roomName = joinedRoom?.name || name || fallbackName;
    const roomTopic =
      (topicEvent?.getContent().topic as string) || undefined || topic || fallbackTopic;
    const joinedMemberCount = joinedRoom?.getJoinedMemberCount() ?? memberCount;

    useStateEventCallback(
      mx,
      useCallback(
        (event) => {
          if (
            joinedRoom &&
            event.getRoomId() === joinedRoom.roomId &&
            event.getType() === StateEvent.RoomTopic
          ) {
            setTopicEvent(getStateEvent(joinedRoom, StateEvent.RoomTopic));
          }
        },
        [joinedRoom]
      )
    );

    const [viewTopic, setViewTopic] = useState(false);
    const closeTopic = () => setViewTopic(false);
    const openTopic = () => setViewTopic(true);
    const accessJoinRule =
      accessStatus === AsyncStatus.Success ? getDiscoveredRoomAccessJoinRule(joinRule) : joinRule;
    const resolvedAccessStatus =
      accessStatus === AsyncStatus.Loading || accessStatus === AsyncStatus.Error
        ? accessStatus
        : isRoomAccessJoinRule(accessJoinRule)
        ? AsyncStatus.Success
        : AsyncStatus.Error;
    const accessRetry = accessStatus === AsyncStatus.Error ? onAccessRetry : undefined;
    const accessFallback =
      resolvedAccessStatus === AsyncStatus.Loading ? (
        <Button
          variant="Secondary"
          size="300"
          disabled
          before={<Spinner size="50" />}
          fill="Soft"
          outlined
          radii="300"
        >
          <Text size="B300" truncate>
            {t('sharedUi.roomCard.checkingAccess')}
          </Text>
        </Button>
      ) : (
        <Button
          onClick={accessRetry}
          variant="Secondary"
          size="300"
          disabled={!accessRetry}
          fill="Soft"
          outlined
          radii="300"
        >
          <Text size="B300" truncate>
            {accessRetry
              ? t('sharedUi.roomCard.retryRoomInfo')
              : t('sharedUi.roomCard.accessUnavailable')}
          </Text>
        </Button>
      );

    return (
      <RoomCardBase {...props} ref={ref}>
        <Box gap="200" justifyContent="SpaceBetween">
          <Avatar size="500">
            <RoomAvatar
              roomId={roomIdOrAlias}
              src={avatar ?? undefined}
              alt={roomIdOrAlias}
              renderFallback={() => (
                <Text as="span" size="H3">
                  {nameInitials(roomName)}
                </Text>
              )}
            />
          </Avatar>
          {(roomType === RoomType.Space || joinedRoom?.isSpaceRoom()) && (
            <Badge variant="Secondary" fill="Soft" outlined>
              <Text size="L400">{t('sharedUi.roomCard.space')}</Text>
            </Badge>
          )}
        </Box>
        <Box grow="Yes" direction="Column" gap="100">
          <RoomCardName>{roomName}</RoomCardName>
          <RoomCardTopic onClick={openTopic} onKeyDown={onEnterOrSpace(openTopic)} tabIndex={0}>
            {roomTopic}
          </RoomCardTopic>

          <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  clickOutsideDeactivates: true,
                  onDeactivate: closeTopic,
                  escapeDeactivates: stopPropagation,
                }}
              >
                {renderTopicViewer(roomName, roomTopic, closeTopic)}
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        </Box>
        {typeof joinedMemberCount === 'number' && (
          <Box gap="100">
            <Icon size="50" src={Icons.User} />
            <Text size="T200">{t('sharedUi.roomCard.members', { count: joinedMemberCount })}</Text>
          </Box>
        )}
        {typeof joinedRoomId === 'string' && (
          <Button
            onClick={onView ? () => onView(joinedRoomId) : undefined}
            variant="Secondary"
            fill="Soft"
            size="300"
            outlined
            radii="300"
          >
            <Text size="B300" truncate>
              {t('sharedUi.roomCard.view')}
            </Text>
          </Button>
        )}
        {typeof joinedRoomId !== 'string' && (
          <RoomAccessControl
            roomIdOrAlias={roomIdOrAlias}
            roomId={roomId}
            roomName={roomName}
            joinRule={resolvedAccessStatus === AsyncStatus.Success ? accessJoinRule : undefined}
            membership={membership}
            viaServers={viaServers}
            fallback={accessFallback}
          >
            {(access) => {
              if (access.kind === 'join' && access.state.status === AsyncStatus.Error) {
                return (
                  <Box gap="200">
                    <Button
                      onClick={access.activate}
                      className={css.ActionButton}
                      variant="Critical"
                      fill="Soft"
                      size="300"
                      outlined
                      radii="300"
                    >
                      <Text size="B300" truncate>
                        {t('sharedUi.roomCard.retry')}
                      </Text>
                    </Button>
                    <ErrorDialog
                      title={t('sharedUi.roomCard.joinError')}
                      message={
                        access.state.error.message ||
                        t('sharedUi.roomCard.failedToJoinUnknownError')
                      }
                    >
                      {(openError) => (
                        <Button
                          onClick={openError}
                          className={css.ActionButton}
                          variant="Critical"
                          fill="Soft"
                          outlined
                          size="300"
                          radii="300"
                        >
                          <Text size="B300" truncate>
                            {t('sharedUi.roomCard.viewError')}
                          </Text>
                        </Button>
                      )}
                    </ErrorDialog>
                  </Box>
                );
              }

              const joining = access.kind === 'join' && (access.loading || access.succeeded);
              return (
                <Button
                  onClick={access.activate}
                  variant="Secondary"
                  size="300"
                  disabled={joining || access.loading || access.requested}
                  before={
                    access.loading ? (
                      <Spinner size="50" variant="Secondary" fill="Soft" />
                    ) : access.requested ? (
                      <Icon size="50" src={Icons.Check} />
                    ) : undefined
                  }
                  fill="Soft"
                  outlined
                  radii="300"
                >
                  <Text size="B300" truncate>
                    {access.kind === 'knock'
                      ? access.loading
                        ? t('sharedUi.roomCard.sendingRequest')
                        : access.requested
                        ? t('sharedUi.roomCard.requestSent')
                        : t('sharedUi.roomCard.requestToJoin')
                      : joining
                      ? t('sharedUi.roomCard.joining')
                      : t('sharedUi.roomCard.join')}
                  </Text>
                </Button>
              );
            }}
          </RoomAccessControl>
        )}
      </RoomCardBase>
    );
  }
);
