import React from 'react';
import { Box, Icon, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/glass/GlassPrimitives';
import { millisecondsToMinutesAndSeconds } from '../../utils/common';
import { VoiceWaveform } from '../../components/voice/VoiceWaveform';
import { VoiceRecorderPhase } from './useVoiceRecorder';
import { useLiquidGlass } from '../../components/glass/liquid/useLiquidGlass';
import * as css from './VoiceRecordingCapsule.css';
import { IconTooltip } from '../tooltip/IconTooltip';

type VoiceRecordingCapsuleProps = {
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  waveform: number[];
  canPause: boolean;
  hasPendingSend?: boolean;
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
};

const isBusyPhase = (phase: VoiceRecorderPhase): boolean =>
  phase === 'requesting' || phase === 'processing' || phase === 'sending';

const getStatusKey = (phase: VoiceRecorderPhase) => {
  if (phase === 'requesting') return 'mindroomUi.voice.statusStarting' as const;
  if (phase === 'paused') return 'mindroomUi.voice.statusPaused' as const;
  if (phase === 'processing') return 'mindroomUi.voice.statusProcessing' as const;
  if (phase === 'sending') return 'mindroomUi.voice.statusSending' as const;
  return 'mindroomUi.voice.statusActive' as const;
};

export function VoiceRecordingCapsule({
  phase,
  elapsedMs,
  waveform,
  canPause,
  hasPendingSend,
  onDiscard,
  onPause,
  onResume,
}: VoiceRecordingCapsuleProps) {
  const { t } = useTranslation();
  const glassRef = useLiquidGlass<HTMLDivElement>();
  const busy = isBusyPhase(phase);
  const paused = phase === 'paused';
  const recording = phase === 'recording';
  const pendingReady = hasPendingSend && phase === 'idle';
  const pauseDisabled = pendingReady || busy || (!paused && (!recording || !canPause));
  const statusText = pendingReady
    ? t('mindroomUi.voice.statusReadyToRetry')
    : t(getStatusKey(phase));

  return (
    <Box ref={glassRef} className={css.Capsule}>
      <IconTooltip label={t('mindroomUi.voice.discardRecording')} position="Top">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            variant="SurfaceVariant"
            size="300"
            radii="300"
            onClick={onDiscard}
            disabled={phase === 'processing' || phase === 'sending'}
            aria-label={t('mindroomUi.voice.discardRecording')}
          >
            <Icon src={Icons.Delete} size="50" />
          </IconButton>
        )}
      </IconTooltip>
      <VoiceWaveform waveform={waveform} dimmed={paused || busy} compact />
      <Text className={css.Timer} size="B300" aria-live="polite">
        {millisecondsToMinutesAndSeconds(elapsedMs)}
      </Text>
      <IconTooltip
        label={
          paused ? t('mindroomUi.voice.resumeRecording') : t('mindroomUi.voice.pauseRecording')
        }
        position="Top"
      >
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            variant="SurfaceVariant"
            size="300"
            radii="300"
            onClick={paused ? onResume : onPause}
            disabled={pauseDisabled}
            aria-label={
              paused ? t('mindroomUi.voice.resumeRecording') : t('mindroomUi.voice.pauseRecording')
            }
            aria-pressed={paused}
          >
            {busy ? (
              <Spinner size="50" variant="Secondary" />
            ) : (
              <Icon src={paused ? Icons.Play : Icons.Pause} size="50" />
            )}
          </IconButton>
        )}
      </IconTooltip>
      <span className={css.HiddenStatus} aria-live="polite">
        {statusText}
      </span>
    </Box>
  );
}
