import { useTranslation } from 'react-i18next';
import React, { type CSSProperties, type ReactNode } from 'react';
import { Box, Chip, color, Text } from 'folds';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { discardFailedLocalEcho, isFailedLocalEchoEvent } from './pendingLocalEcho';

type FailedSendActionsProps = {
  room: Room;
  event: MatrixEvent;
  style?: CSSProperties;
  /** Replaces the default "Not sent" text, for example to name the message. */
  message?: ReactNode;
};

export function FailedSendActions({ room, event, style, message }: FailedSendActionsProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const handleRetry = () => {
    if (!isFailedLocalEchoEvent(event)) return;
    // The SDK reuses the transaction ID, so the server drops a copy that already arrived.
    // A failed retry marks the event unsent again, which brings these actions back.
    mx.resendEvent(event, room).catch(() => undefined);
  };

  return (
    <Box style={style} alignItems="Center" gap="200" wrap="Wrap">
      <Text as="span" size="T200" style={{ color: color.Critical.Main }}>
        {message ?? t('mindroomUi.messages.pendingSendIndicator.notSent')}
      </Text>
      <Chip
        as="button"
        type="button"
        variant="Critical"
        radii="Pill"
        outlined
        onClick={handleRetry}
      >
        <Text size="B300">{t('mindroomUi.messages.failedSendActions.retry')}</Text>
      </Chip>
      <Chip
        as="button"
        type="button"
        variant="SurfaceVariant"
        radii="Pill"
        outlined
        onClick={() => discardFailedLocalEcho(mx, event)}
      >
        <Text size="B300">{t('mindroomUi.messages.failedSendActions.delete')}</Text>
      </Chip>
    </Box>
  );
}
