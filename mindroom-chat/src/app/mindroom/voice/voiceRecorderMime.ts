const PREFERRED_VOICE_RECORDER_MIME_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mpeg',
] as const;

export const DEFAULT_VOICE_RECORDER_MIME_TYPE = PREFERRED_VOICE_RECORDER_MIME_TYPES[0];

export const getPreferredRecorderMimeTypes = (): string[] => [...PREFERRED_VOICE_RECORDER_MIME_TYPES];

export const getSupportedRecorderMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;

  return getPreferredRecorderMimeTypes().find((mimeType) => {
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });
};

export const getAudioFileExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes('ogg')) return 'ogg';
  if (normalizedMimeType.includes('mp4') || normalizedMimeType.includes('aac')) return 'm4a';
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3')) return 'mp3';
  if (normalizedMimeType.includes('webm')) return 'webm';

  return 'ogg';
};
