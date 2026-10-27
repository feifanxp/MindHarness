import { useTranslation } from 'react-i18next';
import React from 'react';
import * as css from './StreamingIndicator.css';

export function StreamingIndicator() {
  const { t } = useTranslation();
  return (
    <span
      className={css.Container}
      role="status"
      aria-label={t('mindroomUi.messages.streamingIndicator.aiIsResponding')}
    >
      <span className={css.Dot0} aria-hidden="true" />
      <span className={css.Dot1} aria-hidden="true" />
      <span className={css.Dot2} aria-hidden="true" />
    </span>
  );
}

export const renderMindroomStreamingIndicator = () => <StreamingIndicator />;
