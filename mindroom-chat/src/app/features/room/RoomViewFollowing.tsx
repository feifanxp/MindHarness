import React, { useState } from 'react';
import { Box, Icon, Icons, Overlay, OverlayBackdrop, OverlayCenter, Text, as, config } from 'folds';
import { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';

import { Trans, useTranslation } from 'react-i18next';
import { Modal, Surface } from '../../components/glass/GlassPrimitives';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './RoomViewFollowing.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomLatestRenderedEvent } from '../../hooks/useRoomLatestRenderedEvent';
import { useRoomEventReaders } from '../../hooks/useRoomEventReaders';
import { EventReaders } from '../../components/event-readers';
import { stopPropagation } from '../../utils/keyboard';

export function RoomViewFollowingPlaceholder() {
  return <div className={css.RoomViewFollowingPlaceholder} />;
}

export type RoomViewFollowingProps = {
  room: Room;
};
export const RoomViewFollowing = as<'div', RoomViewFollowingProps>(
  ({ className, room, ...props }, ref) => {
    const { t } = useTranslation();
    const mx = useMatrixClient();
    const [open, setOpen] = useState(false);
    const latestEvent = useRoomLatestRenderedEvent(room);
    const latestEventReaders = useRoomEventReaders(room, latestEvent?.getId());
    const names = latestEventReaders
      .filter((readerId) => readerId !== mx.getUserId())
      .map(
        (readerId) => getMemberDisplayName(room, readerId) ?? getMxIdLocalPart(readerId) ?? readerId
      );

    const eventId = latestEvent?.getId();

    return (
      <>
        {eventId && (
          <Overlay open={open} backdrop={<OverlayBackdrop />}>
            <OverlayCenter>
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setOpen(false),
                  clickOutsideDeactivates: true,
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Modal variant="Surface" size="300">
                  <EventReaders room={room} eventId={eventId} requestClose={() => setOpen(false)} />
                </Modal>
              </FocusTrap>
            </OverlayCenter>
          </Overlay>
        )}
        <Surface
          level="panel"
          appearance={names.length > 0 ? 'glass' : 'inherit'}
          className={names.length > 0 ? css.FollowingSurface : undefined}
        >
          <Box
            as={names.length > 0 ? 'button' : 'div'}
            onClick={names.length > 0 ? () => setOpen(true) : undefined}
            className={classNames(
              css.RoomViewFollowing({ clickable: names.length > 0 }),
              className
            )}
            alignItems="Center"
            justifyContent="End"
            gap="200"
            {...props}
            ref={ref}
          >
            {names.length > 0 && (
              <>
                <Icon style={{ opacity: config.opacity.P300 }} size="100" src={Icons.CheckTwice} />
                <Text size="T300" truncate>
                  {names.length === 1 && (
                    <Trans
                      i18nKey="featureUi.room.following.one"
                      t={t}
                      shouldUnescape
                      tOptions={{ interpolation: { escapeValue: true } }}
                      values={{ name: names[0] }}
                      components={{ name: <b /> }}
                    />
                  )}
                  {names.length === 2 && (
                    <Trans
                      i18nKey="featureUi.room.following.two"
                      t={t}
                      shouldUnescape
                      tOptions={{ interpolation: { escapeValue: true } }}
                      values={{ first: names[0], second: names[1] }}
                      components={{ first: <b />, second: <b /> }}
                    />
                  )}
                  {names.length === 3 && (
                    <Trans
                      i18nKey="featureUi.room.following.three"
                      t={t}
                      shouldUnescape
                      tOptions={{ interpolation: { escapeValue: true } }}
                      values={{ first: names[0], second: names[1], third: names[2] }}
                      components={{ first: <b />, second: <b />, third: <b /> }}
                    />
                  )}
                  {names.length > 3 && (
                    <Trans
                      i18nKey={
                        names.length === 4
                          ? 'featureUi.room.following.four'
                          : 'featureUi.room.following.many'
                      }
                      t={t}
                      shouldUnescape
                      tOptions={{ interpolation: { escapeValue: true } }}
                      values={{
                        first: names[0],
                        second: names[1],
                        third: names[2],
                        count: names.length - 3,
                      }}
                      components={{ first: <b />, second: <b />, third: <b />, others: <b /> }}
                    />
                  )}
                </Text>
              </>
            )}
          </Box>
        </Surface>
      </>
    );
  }
);
