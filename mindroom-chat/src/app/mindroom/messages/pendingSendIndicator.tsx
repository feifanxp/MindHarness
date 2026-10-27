import { useTranslation } from 'react-i18next';
import React from 'react';
import { color, Icon, Icons, Text } from 'folds';
import * as css from './PendingSendIndicator.css';

export function PendingSendIndicator() {
  const { t } = useTranslation();
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      className={css.Container}
      role="status"
      aria-label={t('mindroomUi.messages.pendingSendIndicator.messageSending')}
      title={t('mindroomUi.messages.pendingSendIndicator.waitingForServer')}
    >
      <Icon data-pending-send-icon="Clock" src={Icons.Clock} size="50" aria-hidden="true" />
    </Text>
  );
}

export const renderPendingSendIndicator = () => <PendingSendIndicator />;

export function FailedSendIndicator() {
  const { t } = useTranslation();
  return (
    <Text
      as="span"
      size="T200"
      priority="300"
      className={css.Container}
      style={{ color: color.Critical.Main }}
      role="status"
      aria-label={t('mindroomUi.messages.pendingSendIndicator.messageFailedToSend')}
      title={t('mindroomUi.messages.pendingSendIndicator.notSent')}
    >
      <Icon data-failed-send-icon="Warning" src={Icons.Warning} size="50" aria-hidden="true" />
    </Text>
  );
}

export const renderFailedSendIndicator = () => <FailedSendIndicator />;
