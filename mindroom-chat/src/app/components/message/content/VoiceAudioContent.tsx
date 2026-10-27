/* eslint-disable jsx-a11y/media-has-caption */
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Icons, PopOut, RectCords, Spinner, Text } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useAtomValue } from 'jotai';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import { Menu } from '../../glass/GlassPrimitives';
import { IAudioInfo } from '../../../../types/matrix/common';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import {
  PlayTimeCallback,
  useMediaLoading,
  useMediaPlay,
  useMediaPlayTimeCallback,
} from '../../../hooks/media';
import { useThrottle } from '../../../hooks/useThrottle';
import { secondsToMinutesAndSeconds } from '../../../utils/common';
import {
  applyVoiceMessageVolume,
  applyVoicePlaybackRate,
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../../mindroom/settings/voiceMessageSettings';
import { VoicePlaybackRateButton } from '../../voice/VoicePlaybackRateButton';
import { VoiceVolumeButton } from '../../voice/VoiceVolumeButton';
import { VoiceWaveform } from '../../voice/VoiceWaveform';
import { bytesToSize } from '../../../utils/common';
import { stopPropagation } from '../../../utils/keyboard';
import { FileDownloadButton } from '../FileHeader';
import { getAudioContentSourceIdentity, useAudioContentSource } from './useAudioContentSource';
import { useLiquidGlass } from '../../glass/liquid/useLiquidGlass';
import * as css from './VoiceAudioContent.css';

const PLAY_TIME_THROTTLE_OPS = {
  wait: 250,
  immediate: true,
};

const formatVoiceTime = (seconds: number) =>
  secondsToMinutesAndSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);

export type VoiceAudioContentProps = {
  owner?: EventAttachmentOwner;
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  filename?: string;
  isVoiceMessage?: boolean;
  waveform?: number[];
  label?: string;
};

export function VoiceAudioContent({
  owner,
  mimeType,
  url,
  info,
  encInfo,
  filename = 'Audio',
  waveform,
  label,
  isVoiceMessage = true,
}: VoiceAudioContentProps) {
  const { t } = useTranslation();
  const glassRef = useLiquidGlass<HTMLDivElement>();
  const [srcState, loadSrc] = useAudioContentSource({ mimeType, url, encInfo, owner });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const pendingSeekTimeRef = useRef<number>();
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [autoPlayOnLoad, setAutoPlayOnLoad] = useState(false);
  const [failedSource, setFailedSource] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [showElapsedTime, setShowElapsedTime] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<RectCords>();
  const playbackRate = useAtomValue(voiceMessagePlaybackRateAtom);
  const volume = useAtomValue(voiceMessageVolumeAtom);
  const infoDuration =
    Number.isFinite(info.duration) && info.duration && info.duration > 0 ? info.duration : 0;
  const hasInfoDuration = infoDuration > 0;
  const [duration, setDuration] = useState(infoDuration / 1000);
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo, owner });
  const mediaIdentityRef = useRef(mediaIdentity);
  const loadIntentRef = useRef(0);
  const browserMeasuredDurationRef = useRef(false);

  const setAudioRef = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    setAudioElement(element);
  }, []);
  const getAudioRef = useCallback(() => audioElement, [audioElement]);
  const { loading, error: mediaError } = useMediaLoading(getAudioRef);
  const { playing, setPlaying } = useMediaPlay(getAudioRef);
  const handlePlayTimeCallback: PlayTimeCallback = useCallback((d, ct) => {
    if (Number.isFinite(d) && d > 0) {
      browserMeasuredDurationRef.current = true;
      setDuration((currentDuration) =>
        Math.abs(currentDuration - d) > 0.01 ? d : currentDuration
      );
    }
    setCurrentTime(Number.isFinite(ct) && ct > 0 ? ct : 0);
  }, []);
  useMediaPlayTimeCallback(
    getAudioRef,
    useThrottle(handlePlayTimeCallback, PLAY_TIME_THROTTLE_OPS)
  );

  useEffect(() => {
    if (!hasInfoDuration) return;

    setDuration((currentDuration) =>
      currentDuration === 0 || !browserMeasuredDurationRef.current
        ? infoDuration / 1000
        : currentDuration
    );
  }, [hasInfoDuration, infoDuration]);

  useEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    mediaIdentityRef.current = mediaIdentity;
    loadIntentRef.current += 1;
    browserMeasuredDurationRef.current = false;
    pendingSeekTimeRef.current = undefined;
    setAutoPlayOnLoad(false);
    setCurrentTime(0);
    setShowElapsedTime(false);
    setDuration(infoDuration / 1000);
  }, [infoDuration, mediaIdentity]);

  const createLoadIntent = useCallback(() => {
    const intent = {
      id: loadIntentRef.current + 1,
      mediaIdentity,
    };
    loadIntentRef.current = intent.id;
    return intent;
  }, [mediaIdentity]);

  const isCurrentLoadIntent = useCallback(
    (intent: { id: number; mediaIdentity: string }) =>
      loadIntentRef.current === intent.id && mediaIdentityRef.current === intent.mediaIdentity,
    []
  );

  const updatePlayTimeFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    handlePlayTimeCallback(audio.duration, audio.currentTime);
  }, [handlePlayTimeCallback]);

  const applyPendingSeek = useCallback(() => {
    const pendingSeekTime = pendingSeekTimeRef.current;
    const audio = audioRef.current;
    // A loaded URL can remount the audio element before its metadata is available.
    if (pendingSeekTime === undefined || !audio || audio.readyState < 1) return;

    try {
      audio.currentTime = pendingSeekTime;
      pendingSeekTimeRef.current = undefined;
      setCurrentTime(pendingSeekTime);
    } catch {
      // Keep the target pending if the browser cannot seek yet.
    }
  }, []);

  useEffect(() => {
    if (srcState.status === AsyncStatus.Success) {
      applyPendingSeek();
    }
  }, [applyPendingSeek, srcState.status]);

  const sourceValue = srcState.status === AsyncStatus.Success ? srcState.data : undefined;
  const audioMediaKey = `${mediaIdentity}:${sourceValue ?? ''}`;
  const hasPlaybackError =
    mediaError || (sourceValue !== undefined && failedSource === sourceValue);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [audioElement, playbackRate, sourceValue, volume]);

  const applyCurrentVoiceSettings = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [playbackRate, volume]);

  const handleLoadedMetadata = useCallback(() => {
    applyCurrentVoiceSettings();
    updatePlayTimeFromAudio();
    applyPendingSeek();
  }, [applyCurrentVoiceSettings, applyPendingSeek, updatePlayTimeFromAudio]);

  const handlePlay = () => {
    applyCurrentVoiceSettings();

    if (srcState.status === AsyncStatus.Success) {
      setAutoPlayOnLoad(false);
      setPlaying(!playing);
    } else if (srcState.status !== AsyncStatus.Loading) {
      const loadIntent = createLoadIntent();
      setAutoPlayOnLoad(true);
      void loadSrc().catch(() => {
        if (!isCurrentLoadIntent(loadIntent)) return;
        setAutoPlayOnLoad(false);
      });
    }
  };

  const handleMoreOpen: MouseEventHandler<HTMLButtonElement> = (event) => {
    const targetRect = event.currentTarget.getBoundingClientRect();
    setMoreAnchor((currentAnchor) => (currentAnchor ? undefined : targetRect));
  };

  const handleSeekProgress = (progress: number) => {
    if (!duration) return;

    setShowElapsedTime(true);
    const nextTime = progress * duration;
    pendingSeekTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    if (srcState.status === AsyncStatus.Success) {
      applyPendingSeek();
      return;
    }

    if (srcState.status !== AsyncStatus.Loading) {
      const loadIntent = createLoadIntent();
      void loadSrc().catch(() => {
        if (!isCurrentLoadIntent(loadIntent)) return;
        pendingSeekTimeRef.current = undefined;
      });
    }
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const displayCurrentTime = Math.min(currentTime, duration || currentTime);
  const displayDuration = duration;
  const sizeText =
    typeof info.size === 'number' && Number.isFinite(info.size) && info.size >= 0
      ? bytesToSize(info.size)
      : undefined;
  const durationText = displayDuration > 0 ? formatVoiceTime(displayDuration) : undefined;
  const mediaLabel = label || t('sharedUi.voiceAudioContent.voiceMessage');

  return (
    <div className={css.Root}>
      {!isVoiceMessage && (
        <Text className={css.Title} size="T200" truncate title={filename}>
          {filename}
        </Text>
      )}
      <div ref={glassRef} className={css.Capsule} data-playing={playing || undefined}>
        <div className={css.PlayCell}>
          <IconButton
            className={css.PlayButton}
            variant="Primary"
            fill="Soft"
            size="400"
            radii="Pill"
            onClick={handlePlay}
            disabled={srcState.status === AsyncStatus.Loading || hasPlaybackError}
            aria-label={
              playing
                ? t('sharedUi.voiceAudioContent.pauseValue1', { value1: mediaLabel })
                : t('sharedUi.voiceAudioContent.playValue1', { value1: mediaLabel })
            }
            aria-pressed={playing}
          >
            {!hasPlaybackError && (srcState.status === AsyncStatus.Loading || loading) ? (
              <Spinner variant="Secondary" size="50" />
            ) : playing ? (
              <IconPlayerPauseFilled size={18} aria-hidden="true" />
            ) : (
              <IconPlayerPlayFilled className={css.PlayIcon} size={18} aria-hidden="true" />
            )}
          </IconButton>
        </div>
        <div className={css.WaveformCell}>
          <VoiceWaveform
            waveform={waveform}
            progress={progress}
            label={t('sharedUi.voiceAudioContent.seekValue1', { value1: mediaLabel })}
            valueText={t('sharedUi.voiceAudioContent.playbackPosition', {
              current: formatVoiceTime(displayCurrentTime),
              duration: formatVoiceTime(displayDuration),
            })}
            disabled={!duration || hasPlaybackError}
            onSeekProgress={handleSeekProgress}
          />
        </div>
        <div className={css.Controls}>
          <Text
            className={css.Time}
            size="B300"
            title={`${formatVoiceTime(displayCurrentTime)} / ${formatVoiceTime(displayDuration)}`}
          >
            {formatVoiceTime(
              showElapsedTime || playing || displayCurrentTime > 0
                ? displayCurrentTime
                : displayDuration
            )}
          </Text>
          <div className={css.RateCell}>
            <VoicePlaybackRateButton />
          </div>
          <div className={css.MoreCell}>
            <IconButton
              ref={moreTriggerRef}
              variant="SurfaceVariant"
              size="300"
              radii="300"
              aria-label={t('sharedUi.voiceAudioContent.moreAudioOptions')}
              aria-haspopup="dialog"
              aria-expanded={moreAnchor ? true : undefined}
              onClick={handleMoreOpen}
            >
              <Icon src={Icons.VerticalDots} size="50" />
            </IconButton>
            <PopOut
              anchor={moreAnchor}
              position="Bottom"
              align="End"
              offset={5}
              content={
                <FocusTrap
                  focusTrapOptions={{
                    initialFocus: false,
                    returnFocusOnDeactivate: false,
                    onDeactivate: () => setMoreAnchor(undefined),
                    clickOutsideDeactivates: (event) => {
                      const target = event.target;
                      return !(
                        typeof Node !== 'undefined' &&
                        target instanceof Node &&
                        moreTriggerRef.current?.contains(target)
                      );
                    },
                    allowOutsideClick: (event) => {
                      const target = event.target;
                      return (
                        typeof Node !== 'undefined' &&
                        target instanceof Node &&
                        !!moreTriggerRef.current?.contains(target)
                      );
                    },
                    escapeDeactivates: stopPropagation,
                  }}
                >
                  <Menu className={css.MoreMenu}>
                    <div className={css.MoreMenuAction}>
                      <Text size="B300">{t('sharedUi.voiceVolumeButton.voiceVolume')}</Text>
                      <VoiceVolumeButton />
                    </div>
                    <div className={css.MoreMenuAction}>
                      <Text size="B300">{t('sharedUi.voiceAudioContent.download')}</Text>
                      <FileDownloadButton
                        owner={owner}
                        filename={filename}
                        url={url}
                        mimeType={mimeType}
                        encInfo={encInfo}
                      />
                    </div>
                    <div className={css.MoreMenuMeta}>
                      <Text className={css.MoreMenuMetaLabel} size="L400">
                        {t('sharedUi.voiceAudioContent.name')}
                      </Text>
                      <Text className={css.MoreMenuMetaValue} size="T200" truncate>
                        {filename}
                      </Text>
                    </div>
                    <div className={css.MoreMenuMeta}>
                      <Text className={css.MoreMenuMetaLabel} size="L400">
                        {t('sharedUi.voiceAudioContent.type')}
                      </Text>
                      <Text className={css.MoreMenuMetaValue} size="T200" truncate>
                        {mimeType}
                      </Text>
                    </div>
                    {sizeText && (
                      <div className={css.MoreMenuMeta}>
                        <Text className={css.MoreMenuMetaLabel} size="L400">
                          {t('sharedUi.voiceAudioContent.size')}
                        </Text>
                        <Text className={css.MoreMenuMetaValue} size="T200">
                          {sizeText}
                        </Text>
                      </div>
                    )}
                    {durationText && (
                      <div className={css.MoreMenuMeta}>
                        <Text className={css.MoreMenuMetaLabel} size="L400">
                          {t('sharedUi.voiceAudioContent.duration')}
                        </Text>
                        <Text className={css.MoreMenuMetaValue} size="T200">
                          {durationText}
                        </Text>
                      </div>
                    )}
                  </Menu>
                </FocusTrap>
              }
            />
          </div>
        </div>
        {(srcState.status === AsyncStatus.Error || hasPlaybackError) && (
          <Text className={css.Error} size="T200" role="status">
            {hasPlaybackError
              ? t('sharedUi.voiceAudioContent.playbackError')
              : t('sharedUi.voiceAudioContent.loadError')}
          </Text>
        )}
        <audio
          key={audioMediaKey}
          className={css.Audio}
          controls={false}
          autoPlay={autoPlayOnLoad}
          ref={setAudioRef}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => {
            setShowElapsedTime(true);
            applyCurrentVoiceSettings();
            updatePlayTimeFromAudio();
            applyPendingSeek();
            setAutoPlayOnLoad(false);
          }}
        >
          {srcState.status === AsyncStatus.Success && (
            <source
              src={srcState.data}
              type={mimeType}
              onError={() => setFailedSource(srcState.data)}
            />
          )}
        </audio>
      </div>
    </div>
  );
}
