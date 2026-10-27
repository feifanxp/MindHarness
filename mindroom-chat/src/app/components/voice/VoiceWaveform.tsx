import { useTranslation } from 'react-i18next';
import React, { KeyboardEventHandler } from 'react';
import classNames from 'classnames';
import {
  clampWaveformPoint,
  createFallbackWaveform,
  VOICE_WAVEFORM_BAR_COUNT,
  VOICE_WAVEFORM_MAX,
  normalizeMatrixWaveform,
} from '../../utils/audioWaveform';
import * as css from './VoiceWaveform.css';

const SVG_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const RECORDING_WAVEFORM_SPEECH_BOOST_START = 0.12;
const RECORDING_WAVEFORM_SPEECH_BOOST = 0.9;
const getSvgWidth = (barCount: number): number =>
  Math.max(BAR_WIDTH, barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP);

const clampProgress = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const normalizeRecordingWaveform = (waveform: number[] | undefined): number[] => {
  if (!Array.isArray(waveform) || waveform.length === 0) return createFallbackWaveform();

  const bars = waveform.map(clampWaveformPoint);
  if (bars.length >= VOICE_WAVEFORM_BAR_COUNT) return bars;

  return [...Array<number>(VOICE_WAVEFORM_BAR_COUNT - bars.length).fill(0), ...bars];
};

const getCompactUnrecordedBarCount = (waveform: number[] | undefined): number => {
  if (!Array.isArray(waveform) || waveform.length === 0) return 0;
  return Math.max(0, VOICE_WAVEFORM_BAR_COUNT - waveform.length);
};

const getBarHeight = (point: number, compact?: boolean): number => {
  const normalizedPoint = point / VOICE_WAVEFORM_MAX;
  const speechProgress = compact
    ? clampProgress(
        (normalizedPoint - RECORDING_WAVEFORM_SPEECH_BOOST_START) /
          (1 - RECORDING_WAVEFORM_SPEECH_BOOST_START)
      )
    : 0;
  const speechBoost =
    normalizedPoint * (1 - normalizedPoint) * RECORDING_WAVEFORM_SPEECH_BOOST * speechProgress;
  const scaledPoint = normalizedPoint + speechBoost;

  return Math.max(3, Math.min(SVG_HEIGHT, scaledPoint * SVG_HEIGHT));
};

type VoiceWaveformProps = {
  waveform?: number[];
  progress?: number;
  dimmed?: boolean;
  compact?: boolean;
  label?: string;
  valueText?: string;
  disabled?: boolean;
  onSeekProgress?: (progress: number) => void;
};

export function VoiceWaveform({
  waveform,
  progress = 0,
  dimmed,
  compact,
  label,
  valueText,
  disabled,
  onSeekProgress,
}: VoiceWaveformProps) {
  const { t } = useTranslation();
  const bars = compact ? normalizeRecordingWaveform(waveform) : normalizeMatrixWaveform(waveform);
  const compactUnrecordedBarCount = compact ? getCompactUnrecordedBarCount(waveform) : 0;
  const svgWidth = getSvgWidth(bars.length || VOICE_WAVEFORM_BAR_COUNT);
  const normalizedProgress = clampProgress(progress);
  const activeBars = Math.round(normalizedProgress * bars.length);

  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (!onSeekProgress || disabled) return;

    if (event.key === 'Home') {
      event.preventDefault();
      onSeekProgress(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onSeekProgress(1);
      return;
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      onSeekProgress(
        clampProgress(
          normalizedProgress + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 0.05 : -0.05)
        )
      );
    }
  };

  const content = (
    <svg
      className={classNames(css.Svg, compact && css.SvgCompact)}
      viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
      {...(compact
        ? {
            width: svgWidth,
            height: SVG_HEIGHT,
            preserveAspectRatio: 'none',
            shapeRendering: 'crispEdges',
          }
        : {
            preserveAspectRatio: 'none',
          })}
      aria-hidden="true"
      focusable="false"
    >
      {bars.map((point, index) => {
        const height = getBarHeight(point, compact);
        const y = (SVG_HEIGHT - height) / 2;

        return (
          <rect
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={classNames(
              index < activeBars ? css.BarActive : css.Bar,
              compact && css.BarCompact,
              compact && index < compactUnrecordedBarCount && css.BarCompactUnrecorded
            )}
            x={index * (BAR_WIDTH + BAR_GAP)}
            y={y}
            width={BAR_WIDTH}
            height={height}
            rx="1"
          />
        );
      })}
    </svg>
  );

  if (onSeekProgress) {
    return (
      <div
        className={classNames(
          css.Waveform,
          compact && css.WaveformCompact,
          css.WaveformSeek,
          dimmed && css.WaveformDimmed
        )}
      >
        {content}
        <input
          className={css.SeekInput}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={normalizedProgress * 100}
          disabled={disabled}
          aria-label={label ?? t('sharedUi.voiceWaveform.seekVoiceMessage')}
          aria-valuetext={valueText ?? `${Math.round(normalizedProgress * 100)}%`}
          onChange={(event) =>
            onSeekProgress(clampProgress(Number(event.currentTarget.value) / 100))
          }
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      className={classNames(
        css.Waveform,
        compact && css.WaveformCompact,
        dimmed && css.WaveformDimmed
      )}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {content}
    </div>
  );
}
