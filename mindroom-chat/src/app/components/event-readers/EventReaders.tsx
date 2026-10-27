import { useTranslation } from 'react-i18next';
import React from 'react';
import classNames from 'classnames';
import { Avatar, Box, Icon, IconButton, Icons, Text, as, config } from 'folds';
import { Room } from 'matrix-js-sdk';
import { PageScroll } from '../page';
import { Header, MenuItem } from '../glass/GlassPrimitives';
import { useRoomEventReaders } from '../../hooks/useRoomEventReaders';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import * as css from './EventReaders.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { UserAvatar } from '../user-avatar';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { getMouseEventCords } from '../../utils/dom';

export type EventReadersProps = {
  room: Room;
  eventId: string;
  requestClose: () => void;
};
export const EventReaders = as<'div', EventReadersProps>(
  ({ className, room, eventId, requestClose, ...props }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const latestEventReaders = useRoomEventReaders(room, eventId);
    const openProfile = useOpenUserRoomProfile();
    const space = useSpaceOptionally();

    const getName = (userId: string) =>
      getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

    return (
      <Box
        className={classNames(css.EventReaders, className)}
        direction="Column"
        {...props}
        ref={ref}
      >
        <PageScroll
          header={
            <Header className={css.Header} variant="Surface" size="600">
              <Box grow="Yes">
                <Text size="H3">{t('sharedUi.eventReaders.seenBy')}</Text>
              </Box>
              <IconButton size="300" onClick={requestClose}>
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
          }
        >
          <Box className={css.Content} direction="Column">
            {latestEventReaders.map((readerId) => {
              const name = getName(readerId);
              const avatarMxcUrl = room.getMember(readerId)?.getMxcAvatarUrl();
              const avatarUrl = avatarMxcUrl
                ? mxcUrlToHttp(mx, avatarMxcUrl, useAuthentication, 100, 100, 'crop')
                : undefined;

              return (
                <MenuItem
                  key={readerId}
                  style={{ padding: `0 ${config.space.S200}` }}
                  radii="400"
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    openProfile(
                      room.roomId,
                      space?.roomId,
                      readerId,
                      getMouseEventCords(event.nativeEvent),
                      'Bottom'
                    );
                  }}
                  before={
                    <Avatar size="200">
                      <UserAvatar
                        userId={readerId}
                        src={avatarUrl ?? undefined}
                        alt={name}
                        renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                      />
                    </Avatar>
                  }
                >
                  <Text size="T400" truncate>
                    {name}
                  </Text>
                </MenuItem>
              );
            })}
          </Box>
        </PageScroll>
      </Box>
    );
  }
);
