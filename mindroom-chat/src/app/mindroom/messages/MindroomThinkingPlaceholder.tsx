import { useTranslation } from 'react-i18next';
import React from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { MINDROOM_LOGO_SRC } from '../branding/branding';
import * as css from './MindroomThinkingPlaceholder.css';
import { resolveMindroomThinkingPlaceholderMessages } from './thinkingPlaceholder';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from './thinkingPlaceholder';

const ROTATION_INTERVAL_MS = 3600;

export function MindroomThinkingPlaceholder() {
  const { t } = useTranslation();
  const clientConfig = useClientConfig();
  const messages = React.useMemo(
    () =>
      resolveMindroomThinkingPlaceholderMessages(
        clientConfig.mindroom?.thinkingPlaceholderMessages
      ),
    [clientConfig.mindroom?.thinkingPlaceholderMessages]
  );
  const [messageIndex, setMessageIndex] = React.useState(0);

  React.useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, ROTATION_INTERVAL_MS);

    return () => globalThis.clearInterval(intervalId);
  }, [messages.length]);

  const configuredMessage = messages[messageIndex % messages.length];
  const message =
    configuredMessage === MINDROOM_THINKING_PLACEHOLDER_BODY
      ? t('mindroomUi.messages.mindroomThinkingPlaceholder.thinking')
      : configuredMessage;

  return (
    <span
      className={css.Placeholder}
      role="status"
      aria-label={t('mindroomUi.messages.mindroomThinkingPlaceholder.aiIsResponding')}
    >
      <span className={css.Indicator} aria-hidden="true">
        <span className={css.Aura} />
        <span className={css.Rotor}>
          <img className={css.Mark} src={MINDROOM_LOGO_SRC} alt="" />
        </span>
      </span>
      <span className={css.Text} aria-hidden="true">
        <span className={css.TextBase}>{message}</span>
        <span className={css.TextSweep} aria-hidden="true">
          <span className={css.TextCounter}>
            <span className={css.TextHighlight}>{message}</span>
          </span>
        </span>
      </span>
    </span>
  );
}
