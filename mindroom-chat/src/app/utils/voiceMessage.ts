import {
  IMatrixAudioDetails,
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../types/matrix/common';
import { normalizeOptionalMatrixWaveform } from './audioWaveform';

type UnknownRecord = Record<string, unknown>;

const isObject = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeAudioDetails = (value: unknown): IMatrixAudioDetails | undefined => {
  if (!isObject(value)) return undefined;

  const duration =
    typeof value.duration === 'number' && Number.isFinite(value.duration)
      ? value.duration
      : undefined;
  const waveform = normalizeOptionalMatrixWaveform(value.waveform);

  if (duration === undefined && waveform === undefined) return undefined;

  return {
    ...(duration !== undefined ? { duration } : {}),
    ...(waveform !== undefined ? { waveform } : {}),
  };
};

export const isVoiceMessageContent = (content: UnknownRecord): boolean =>
  isObject(content[MATRIX_VOICE_MESSAGE_PROPERTY_NAME]) ||
  isObject(content[MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]);

export const getVoiceMessageAudioDetails = (
  content: UnknownRecord
): IMatrixAudioDetails | undefined =>
  sanitizeAudioDetails(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]) ??
  sanitizeAudioDetails(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]);

type VoiceMessageOptions = {
  duration: number;
  waveform?: number[];
};

export const addVoiceMessageMetadata = <T extends UnknownRecord>(
  content: T,
  options: VoiceMessageOptions
): T => {
  const waveform = normalizeOptionalMatrixWaveform(options.waveform);
  const audioDetails: IMatrixAudioDetails = {
    duration: options.duration,
    ...(waveform ? { waveform } : {}),
  };

  return {
    ...content,
    [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
    [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
    [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: audioDetails,
    [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: audioDetails,
  };
};
