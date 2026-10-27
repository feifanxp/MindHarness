import { useTranslation } from 'react-i18next';
import React from 'react';
import { Text } from 'folds';
import { useAtom } from 'jotai';
import {
  cycleVoicePlaybackRate,
  formatVoicePlaybackRate,
  voiceMessagePlaybackRateAtom,
} from '../../mindroom/settings/voiceMessageSettings';
import * as css from './VoicePlaybackRateButton.css';

export function VoicePlaybackRateButton() {
  const { t } = useTranslation();
  const [rate, setRate] = useAtom(voiceMessagePlaybackRateAtom);
  const label = formatVoicePlaybackRate(rate);

  return (
    <button
      className={css.Button}
      type="button"
      aria-label={t('sharedUi.voicePlaybackRateButton.playbackSpeedCurrentlyValue1ClickToCycle', {
        value1: label,
      })}
      onClick={() => setRate(cycleVoicePlaybackRate(rate))}
    >
      <Text as="span" className={css.Label} size="B300">
        {label}
      </Text>
    </button>
  );
}
