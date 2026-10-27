import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import React, { MouseEventHandler, useRef, useState } from 'react';
import { Icon, Icons, IconSrc, PopOut, RectCords } from 'folds';
import { Range } from 'react-range';
import { useAtom } from 'jotai';
import { Menu } from '../glass/GlassPrimitives';
import {
  sanitizeVoiceMessageVolume,
  voiceMessageVolumeAtom,
} from '../../mindroom/settings/voiceMessageSettings';
import { stopPropagation } from '../../utils/keyboard';
import * as css from './VoiceVolumeButton.css';

const VOLUME_RANGE_STEP = 0.05;
const VOLUME_THUMB_CENTER_OFFSET_PX = -16;

const getVolumeIcon = (volume: number): IconSrc => {
  const v = sanitizeVoiceMessageVolume(volume);

  if (v === 0) return Icons.VolumeMute;
  return Icons.VolumeHigh;
};

const formatVolumePercent = (volume: number): number =>
  Math.round(sanitizeVoiceMessageVolume(volume) * 100);

export function VoiceVolumeButton() {
  const { t } = useTranslation();
  const [volume, setVolume] = useAtom(voiceMessageVolumeAtom);
  const [anchor, setAnchor] = useState<RectCords>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const volumePercent = formatVolumePercent(volume);

  const handleOpen: MouseEventHandler<HTMLButtonElement> = (event) => {
    const targetRect = event.currentTarget.getBoundingClientRect();
    setAnchor((currentAnchor) => (currentAnchor ? undefined : targetRect));
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={css.Button}
        type="button"
        aria-label={t('sharedUi.voiceVolumeButton.voiceVolumeCurrentlyValue1', {
          value1: volumePercent,
        })}
        aria-haspopup="dialog"
        aria-expanded={anchor ? true : undefined}
        onClick={handleOpen}
      >
        <Icon src={getVolumeIcon(volume)} size="50" />
      </button>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="End"
        offset={5}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setAnchor(undefined),
              clickOutsideDeactivates: (event) => {
                const target = event.target;
                return !(
                  typeof Node !== 'undefined' &&
                  target instanceof Node &&
                  triggerRef.current?.contains(target)
                );
              },
              allowOutsideClick: (event) => {
                const target = event.target;
                return (
                  typeof Node !== 'undefined' &&
                  target instanceof Node &&
                  !!triggerRef.current?.contains(target)
                );
              },
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu className={css.Menu}>
              <Range
                step={VOLUME_RANGE_STEP}
                min={0}
                max={1}
                values={[volume]}
                onChange={(values) => setVolume(values[0])}
                renderTrack={(params) => (
                  <div
                    {...params.props}
                    className={css.Track}
                    style={{
                      ...params.props.style,
                    }}
                  >
                    <div className={css.TrackLine} />
                    {params.children}
                  </div>
                )}
                renderThumb={(params) => (
                  <div
                    {...params.props}
                    aria-label={t('sharedUi.voiceVolumeButton.voiceVolume')}
                    className={css.Thumb}
                    style={{
                      ...params.props.style,
                      marginTop: VOLUME_THUMB_CENTER_OFFSET_PX,
                    }}
                  />
                )}
              />
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
