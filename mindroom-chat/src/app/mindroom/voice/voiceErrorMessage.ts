import type { TFunction } from 'i18next';

export const localizeVoiceErrorMessage = (
  t: TFunction,
  message: string | undefined,
  fallback = message
) => {
  if (!message) return message;
  if (message.includes('Android app settings'))
    return t('mindroomUi.voice.errors.microphoneBlockedAndroid');
  if (message.includes('iPhone settings')) return t('mindroomUi.voice.errors.microphoneBlockedIos');
  switch (message) {
    case 'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.':
      return t('mindroomUi.voice.errors.microphoneBlockedBrowser');
    case 'No microphone was found on this device.':
      return t('mindroomUi.voice.errors.noMicrophone');
    case 'Microphone is unavailable right now (it may be in use by another app).':
      return t('mindroomUi.voice.errors.microphoneUnavailable');
    case 'Failed to access microphone.':
      return t('mindroomUi.voice.errors.microphoneFailed');
    case 'Microphone access is not supported on this device.':
      return t('mindroomUi.voice.errors.microphoneUnsupported');
    case 'Voice recording stopped unexpectedly. Please record again.':
      return t('mindroomUi.voice.errors.recordingStopped');
    case 'No audio data was captured.':
      return t('mindroomUi.voice.errors.noAudio');
    case 'Voice recording is not supported in this browser.':
      return t('mindroomUi.voice.errors.recordingUnsupported');
    case 'Voice recording requires HTTPS (or localhost). Open MindRoom over HTTPS.':
      return t('mindroomUi.voice.errors.httpsRequired');
    case 'Another voice message is still sending. Please wait.':
      return t('mindroomUi.voice.errors.sendBusy');
    case 'Failed to send voice message.':
      return t('mindroomUi.voice.errors.sendFailed');
    default:
      return fallback;
  }
};
