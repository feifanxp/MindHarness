import { MatrixError } from 'matrix-js-sdk';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../utils/matrix';
import type {
  PendingVoiceSendContext,
  PendingVoiceSendDraft,
  PendingVoiceSendInFlight,
} from '../../state/room/roomInputDrafts';
import type { CapturedVoiceRecording } from './voiceCaptureSession';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';

export type SendRecordingCallback = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  context: PendingVoiceSendContext
) => Promise<void> | void;

export type VoiceDraftStore = {
  read: () => PendingVoiceSendDraft | undefined;
  write: (draft: PendingVoiceSendDraft | undefined) => void;
};

export type VoiceSendAttempt = {
  sendRecording: SendRecordingCallback;
  onFailure: () => void;
};

export type VoiceSendDraftController = {
  sendInitial: (
    recording: CapturedVoiceRecording,
    context: PendingVoiceSendContext,
    attempt: VoiceSendAttempt
  ) => Promise<boolean>;
  retry: (attempt: VoiceSendAttempt & { claim: () => boolean | void }) => Promise<boolean>;
  discardPending: () => void;
};

const getVoiceSendErrorMessage = (error: unknown): string => {
  if (error instanceof MatrixError) {
    return getMatrixUploadErrorMessage(error, getMatrixUploadErrorStage(error) ?? 'send');
  }
  if (error instanceof Error) return error.message;
  return 'Failed to send voice message.';
};

const createRetryToken = (): PendingVoiceSendInFlight => ({
  token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  startedAt: Date.now(),
});

export const createVoiceSendDraftController = (
  drafts: VoiceDraftStore
): VoiceSendDraftController => {
  let retryBusy = false;

  const sendInitial: VoiceSendDraftController['sendInitial'] = async (
    recording,
    context,
    attempt
  ) => {
    try {
      await attempt.sendRecording(recording.file, recording.duration, recording.waveform, context);
      drafts.write(undefined);
      return true;
    } catch (error) {
      drafts.write({
        file: recording.file,
        duration: recording.duration,
        waveform: recording.waveform,
        context,
        errorMessage: getVoiceSendErrorMessage(error),
      });
      attempt.onFailure();
      return false;
    }
  };

  const retry: VoiceSendDraftController['retry'] = async (attempt) => {
    const draft = drafts.read();
    if (retryBusy || !draft || draft.inFlight) return false;

    retryBusy = true;
    try {
      if (attempt.claim() === false) {
        if (drafts.read() === draft) {
          drafts.write({ ...draft, errorMessage: RETRY_BUSY_MESSAGE });
        }
        return false;
      }

      const currentDraft = drafts.read();
      if (currentDraft !== draft || currentDraft.inFlight) {
        attempt.onFailure();
        return false;
      }

      const inFlight = createRetryToken();
      drafts.write({ ...draft, errorMessage: undefined, inFlight });
      if (drafts.read()?.inFlight?.token !== inFlight.token) {
        attempt.onFailure();
        return false;
      }
      try {
        await attempt.sendRecording(draft.file, draft.duration, draft.waveform, draft.context);
        const current = drafts.read();
        if (current?.inFlight?.token === inFlight.token) {
          drafts.write(undefined);
        }
        return true;
      } catch (error) {
        const current = drafts.read();
        if (!current || current.inFlight?.token !== inFlight.token) return false;
        drafts.write({
          ...current,
          inFlight: undefined,
          errorMessage: getVoiceSendErrorMessage(error),
        });
        attempt.onFailure();
        return false;
      }
    } finally {
      retryBusy = false;
    }
  };

  return {
    sendInitial,
    retry,
    discardPending: () => drafts.write(undefined),
  };
};
