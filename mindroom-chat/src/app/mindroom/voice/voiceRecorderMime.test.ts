import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_RECORDER_MIME_TYPE,
  getAudioFileExtension,
  getPreferredRecorderMimeTypes,
  getSupportedRecorderMimeType,
} from './voiceRecorderMime';

const originalMediaRecorder = globalThis.MediaRecorder;

const setMediaRecorderMock = (isTypeSupported: (mimeType: string) => boolean) => {
  class MockMediaRecorder {
    static isTypeSupported(mimeType: string): boolean {
      return isTypeSupported(mimeType);
    }
  }

  Object.assign(globalThis, {
    MediaRecorder: MockMediaRecorder as unknown as typeof MediaRecorder,
  });
};

afterEach(() => {
  if (originalMediaRecorder) {
    Object.assign(globalThis, { MediaRecorder: originalMediaRecorder });
    return;
  }

  Reflect.deleteProperty(globalThis, 'MediaRecorder');
});

describe('voiceRecorderMime helpers', () => {
  it('prefers Ogg/Opus over WebM', () => {
    const mimeTypes = getPreferredRecorderMimeTypes();

    expect(mimeTypes[0]).toBe(DEFAULT_VOICE_RECORDER_MIME_TYPE);
    expect(mimeTypes[0]).toBe('audio/ogg;codecs=opus');
    expect(mimeTypes.indexOf('audio/ogg;codecs=opus')).toBeLessThan(
      mimeTypes.indexOf('audio/webm;codecs=opus')
    );
  });

  it('selects the first supported mime type from preference order', () => {
    setMediaRecorderMock((mimeType) =>
      ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].includes(mimeType)
    );

    expect(getSupportedRecorderMimeType()).toBe('audio/ogg;codecs=opus');
  });

  it('returns undefined when MediaRecorder is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'MediaRecorder');

    expect(getSupportedRecorderMimeType()).toBeUndefined();
  });

  it('maps recorder mime types to file extensions', () => {
    expect(getAudioFileExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(getAudioFileExtension('audio/mp4')).toBe('m4a');
    expect(getAudioFileExtension('audio/mpeg')).toBe('mp3');
    expect(getAudioFileExtension('audio/webm')).toBe('webm');
    expect(getAudioFileExtension('application/octet-stream')).toBe('ogg');
  });
});
