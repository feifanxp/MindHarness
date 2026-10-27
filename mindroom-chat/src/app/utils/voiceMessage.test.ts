import { describe, expect, it } from 'vitest';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../types/matrix/common';
import { VOICE_WAVEFORM_BAR_COUNT } from './audioWaveform';
import {
  addVoiceMessageMetadata,
  getVoiceMessageAudioDetails,
  isVoiceMessageContent,
} from './voiceMessage';

describe('voiceMessage utils', () => {
  it('adds stable and unstable voice message metadata with normalized waveform data', () => {
    const content = addVoiceMessageMetadata(
      { msgtype: 'm.audio', body: 'voice.webm' },
      { duration: 1234, waveform: [0, 512, 2048] }
    ) as Record<string, unknown>;
    const expectedAudioDetails = {
      duration: 1234,
      waveform: expect.arrayContaining([0, 1024]),
    };

    expect(content[MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]).toEqual({});
    expect(content[MATRIX_VOICE_MESSAGE_PROPERTY_NAME]).toEqual({});
    expect(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]).toMatchObject(
      expectedAudioDetails
    );
    expect(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]).toMatchObject(expectedAudioDetails);
    expect(
      (content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] as { waveform: number[] }).waveform
    ).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('detects stable and unstable voice message flags', () => {
    expect(
      isVoiceMessageContent({
        [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      })
    ).toBe(true);
    expect(
      isVoiceMessageContent({
        [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
      })
    ).toBe(true);
    expect(isVoiceMessageContent({})).toBe(false);
  });

  it('returns sanitized audio details preferring stable key', () => {
    const details = getVoiceMessageAudioDetails({
      [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
        duration: 5000,
        waveform: [0, 1, 2, 'bad'],
      },
      [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: {
        duration: 2000,
      },
    });

    expect(details).toMatchObject({
      duration: 5000,
    });
    expect(details?.waveform).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(details?.waveform?.[0]).toBe(0);
  });

  it('keeps duration-only metadata valid when waveform is absent', () => {
    const content = addVoiceMessageMetadata(
      { msgtype: 'm.audio', body: 'voice.webm' },
      { duration: 1234 }
    ) as Record<string, unknown>;

    expect(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]).toEqual({ duration: 1234 });
    expect(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]).toEqual({ duration: 1234 });
  });
});
