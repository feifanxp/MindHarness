import { MsgType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME,
} from '../../../types/matrix/common';
import { TUploadItem } from '../../state/room/roomInputDrafts';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../utils/audioWaveform';
import { getAudioMsgContent } from './msgContent';

const createUploadItem = (file: File, duration?: number, waveform?: number[]): TUploadItem => ({
  file,
  originalFile: file,
  encInfo: undefined,
  metadata: {
    markedAsSpoiler: false,
    ...(typeof duration === 'number'
      ? { voiceMessage: { duration, ...(waveform ? { waveform } : {}) } }
      : {}),
  },
});

describe('getAudioMsgContent', () => {
  it('builds a regular audio message', () => {
    const file = new File(['hello'], 'clip.webm', { type: 'audio/webm' });

    expect(getAudioMsgContent(createUploadItem(file), 'mxc://server/id')).toEqual({
      msgtype: MsgType.Audio,
      filename: 'clip.webm',
      body: 'clip.webm',
      info: {
        mimetype: 'audio/webm',
        size: file.size,
      },
      url: 'mxc://server/id',
    });
  });

  it('adds voice-message metadata and duration', () => {
    const file = new File(['hello'], 'voice.webm', { type: 'audio/webm' });
    const content = getAudioMsgContent(createUploadItem(file, 3210), 'mxc://server/voice');

    expect(content).toMatchObject({
      msgtype: MsgType.Audio,
      filename: 'voice.webm',
      body: 'voice.webm',
      url: 'mxc://server/voice',
      info: {
        mimetype: 'audio/webm',
        size: file.size,
        duration: 3210,
      },
      [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
      [MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]: {
        duration: 3210,
      },
      [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
        duration: 3210,
      },
    });
  });

  it('passes normalized voice waveform metadata through stable and unstable audio details', () => {
    const file = new File(['hello'], 'voice.webm', { type: 'audio/webm' });
    const content = getAudioMsgContent(
      createUploadItem(file, 3210, [0, 256, 2048]),
      'mxc://server/voice'
    );

    expect(content[MATRIX_AUDIO_DETAILS_UNSTABLE_PROPERTY_NAME]).toMatchObject({
      duration: 3210,
      waveform: expect.arrayContaining([0, 1024]),
    });
    expect(content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME]).toMatchObject({
      duration: 3210,
      waveform: expect.arrayContaining([0, 1024]),
    });
    expect(
      (content[MATRIX_AUDIO_DETAILS_PROPERTY_NAME] as { waveform: number[] }).waveform
    ).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
  });

  it('uses voice-message mime override for bridged signal rooms', () => {
    const file = new File(['hello'], 'voice.m4a', { type: 'audio/mp4' });
    const content = getAudioMsgContent(createUploadItem(file, 3210), 'mxc://server/voice', {
      voiceMessageMimeTypeOverride: 'audio/aac',
    });

    expect(content).toMatchObject({
      info: {
        mimetype: 'audio/aac',
        size: file.size,
        duration: 3210,
      },
      [MATRIX_VOICE_MESSAGE_UNSTABLE_PROPERTY_NAME]: {},
      [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
    });
  });

  it('does not override mime type for non-voice audio attachments', () => {
    const file = new File(['hello'], 'clip.m4a', { type: 'audio/mp4' });
    const content = getAudioMsgContent(createUploadItem(file), 'mxc://server/audio', {
      voiceMessageMimeTypeOverride: 'audio/aac',
    });

    expect(content).toMatchObject({
      info: {
        mimetype: 'audio/mp4',
        size: file.size,
      },
    });
  });
});
