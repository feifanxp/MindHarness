import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { createFallbackWaveform } from '../../utils/audioWaveform';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
} from '../../state/room/roomInputDrafts';
import { createVoiceCaptureSession, type VoiceCapturePhase } from './voiceCaptureSession';
import {
  createVoiceSendDraftController,
  type SendRecordingCallback,
} from './voiceSendDraftController';

export {
  VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
  getVoiceRecorderErrorMessage,
} from './voiceCaptureSession';
export type VoiceRecorderPhase = VoiceCapturePhase | 'sending';

type UseVoiceRecorderOptions = {
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: SendRecordingCallback;
  /**
   * Supplies the room/thread/reply context for the next send.
   * The room is captured at start() and remains authoritative across navigation.
   * A same-room relation is refreshed when Send is claimed and becomes the durable retry context.
   */
  getSendContext: () => PendingVoiceSendContext;
};

export function useVoiceRecorder({
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: UseVoiceRecorderOptions) {
  const store = useStore();
  const [capture] = useState(createVoiceCaptureSession);
  const [draftController] = useState(() =>
    createVoiceSendDraftController({
      read: () => store.get(pendingVoiceSendDraftAtom),
      write: (draft) => store.set(pendingVoiceSendDraftAtom, draft),
    })
  );
  const captureSnapshot = useSyncExternalStore(
    capture.subscribe,
    capture.getSnapshot,
    capture.getSnapshot
  );
  const [sending, setSending] = useState(false);
  const pendingDraft = useAtomValue(pendingVoiceSendDraftAtom);
  const phase: VoiceRecorderPhase =
    pendingDraft?.inFlight || sending ? 'sending' : captureSnapshot.phase;
  const { elapsedMs, waveform, canPause } = captureSnapshot;
  const hasPendingSend = !!pendingDraft;
  const pendingDuration = pendingDraft?.duration ?? 0;
  const pendingWaveform = pendingDraft?.waveform ?? createFallbackWaveform();
  const errorMessage = pendingDraft?.errorMessage ?? captureSnapshot.errorMessage;
  const mountedRef = useRef(true);
  const latestOnRecordingStartRef = useRef(onRecordingStart);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const latestGetSendContextRef = useRef(getSendContext);
  const sendBindingAtStartRef = useRef<{
    sendRecording: SendRecordingCallback | undefined;
    context: PendingVoiceSendContext;
  }>();
  useEffect(() => {
    latestOnRecordingStartRef.current = onRecordingStart;
  }, [onRecordingStart]);
  useEffect(() => {
    latestOnSendStopRequestRef.current = onSendStopRequest;
  }, [onSendStopRequest]);
  useEffect(() => {
    latestOnSendStopFailureRef.current = onSendStopFailure;
  }, [onSendStopFailure]);
  useEffect(() => {
    latestOnSendRecordingRef.current = onSendRecording;
  }, [onSendRecording]);
  useEffect(() => {
    latestGetSendContextRef.current = getSendContext;
  }, [getSendContext]);

  const safeSetPhase = useCallback((next: 'idle' | 'sending') => {
    if (mountedRef.current) setSending(next === 'sending');
  }, []);
  const claimSendStop = useCallback(() => {
    return latestOnSendStopRequestRef.current?.();
  }, []);
  const notifySendStopFailure = useCallback(() => {
    latestOnSendStopFailureRef.current?.();
  }, []);
  const resetLocalRecorderState = useCallback(() => {
    capture.reset();
    sendBindingAtStartRef.current = undefined;
    safeSetPhase('idle');
  }, [capture, safeSetPhase]);
  // Full reset is only for callers that already own the durable draft.
  const reset = useCallback(() => {
    resetLocalRecorderState();
    draftController.discardPending();
  }, [draftController, resetLocalRecorderState]);

  const start = useCallback(async () => {
    if (phase !== 'idle' || capture.getSnapshot().phase !== 'idle' || hasPendingSend) return false;
    latestOnRecordingStartRef.current?.();
    sendBindingAtStartRef.current = {
      sendRecording: latestOnSendRecordingRef.current,
      context: latestGetSendContextRef.current(),
    };
    return capture.start();
  }, [capture, hasPendingSend, phase]);

  const send = useCallback(async (): Promise<boolean> => {
    if (!capture.canStop()) return false;
    if (claimSendStop() === false) return false;
    const startBinding = sendBindingAtStartRef.current;
    const recordingContext = startBinding?.context;
    const currentContext = latestGetSendContextRef.current();
    if (
      startBinding &&
      recordingContext &&
      currentContext.ownerSessionId === recordingContext.ownerSessionId &&
      currentContext.roomId === recordingContext.roomId
    ) {
      sendBindingAtStartRef.current = {
        ...startBinding,
        context: {
          ...recordingContext,
          threadId: currentContext.threadId,
          replyDraft: currentContext.replyDraft,
          threadingEnabled: currentContext.threadingEnabled,
        },
      };
    }
    // Bind accepted work before native stop or any await can outlive this facade.
    const acceptedBinding = sendBindingAtStartRef.current;
    const sendRecording = acceptedBinding?.sendRecording;
    const sendContext = acceptedBinding?.context;
    const result = await capture.finish();
    if (result.status !== 'captured' || !sendRecording || !sendContext) {
      if (result.status === 'captured') capture.reset();
      notifySendStopFailure();
      return false;
    }
    safeSetPhase('sending');
    const delivered = await draftController.sendInitial(result.recording, sendContext, {
      sendRecording,
      onFailure: notifySendStopFailure,
    });
    if (sendBindingAtStartRef.current === acceptedBinding) {
      capture.reset();
      safeSetPhase('idle');
      if (delivered) sendBindingAtStartRef.current = undefined;
    }
    return delivered;
  }, [capture, claimSendStop, draftController, notifySendStopFailure, safeSetPhase]);

  const discard = useCallback(async () => {
    const result = await capture.discard();
    if (capture.getSnapshot().phase === 'idle') {
      sendBindingAtStartRef.current = undefined;
    }
    return result;
  }, [capture]);
  const { pause, resume, clearError } = capture;

  const retry = useCallback(async (): Promise<boolean> => {
    if (sending || capture.getSnapshot().phase === 'processing') return false;
    const activeBinding = sendBindingAtStartRef.current;
    const sendRecording = activeBinding?.sendRecording ?? latestOnSendRecordingRef.current;
    if (!sendRecording) return false;

    const delivered = await draftController.retry({
      claim: claimSendStop,
      sendRecording,
      onFailure: notifySendStopFailure,
    });
    if (delivered && sendBindingAtStartRef.current === activeBinding) {
      resetLocalRecorderState();
    }
    return delivered;
  }, [
    capture,
    claimSendStop,
    draftController,
    notifySendStopFailure,
    resetLocalRecorderState,
    sending,
  ]);

  const discardPending = useCallback(() => {
    sendBindingAtStartRef.current = undefined;
    draftController.discardPending();
    capture.reset();
    safeSetPhase('idle');
  }, [capture, draftController, safeSetPhase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      capture.releaseOwner();
    };
  }, [capture]);

  return {
    phase,
    elapsedMs,
    waveform,
    errorMessage,
    canPause,
    hasPendingSend,
    pendingDuration,
    pendingWaveform,
    start,
    pause,
    resume,
    send,
    discard,
    retry,
    discardPending,
    reset,
    clearError,
  };
}
