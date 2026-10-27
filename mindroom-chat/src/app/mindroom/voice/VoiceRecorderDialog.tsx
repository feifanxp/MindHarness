import { useTranslation } from 'react-i18next';
import React, {
  type ForwardRefRenderFunction,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Box, Button, Line, Overlay, OverlayBackdrop, OverlayCenter, Text, config } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Dialog } from '../../components/glass/GlassPrimitives';
import { localizeVoiceErrorMessage } from './voiceErrorMessage';
import { VoiceRecordingCapsule } from './VoiceRecordingCapsule';
import { useVoiceRecorder } from './useVoiceRecorder';
import { stopPropagation } from '../../utils/keyboard';
import type { PendingVoiceSendContext } from '../../state/room/roomInputDrafts';

type VoiceRecorderComposerProps = {
  active: boolean;
  sendDisabled?: boolean;
  onClose: () => void;
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onRetryRequest: () => void;
  onSendRecording: (
    file: File,
    duration: number,
    waveform: number[] | undefined,
    context: PendingVoiceSendContext
  ) => Promise<void> | void;
  getSendContext: () => PendingVoiceSendContext;
};

export type VoiceRecorderComposerHandle = {
  send: () => Promise<boolean>;
};

const VoiceRecorderComposerRender: ForwardRefRenderFunction<
  VoiceRecorderComposerHandle,
  VoiceRecorderComposerProps
> = (
  {
    active,
    sendDisabled,
    onClose,
    onRecordingStart,
    onSendStopRequest,
    onSendStopFailure,
    onRetryRequest,
    onSendRecording,
    getSendContext,
  },
  ref
) => {
  const { t } = useTranslation();
  const autoStartTriggeredRef = useRef(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  // Tracks a deferred (backdrop/Escape-dismissed) failure overlay. The
  // capsule + parked draft remain visible; the user can re-open the overlay
  // by retrying through primary composer Send. A fresh failure surfaces a fresh
  // overlay because errorMessage will differ from the deferred value.
  // The defer signal MUST come from the per-event predicates below
  // (clickOutsideDeactivates / escapeDeactivates), NOT from FocusTrap's
  // onDeactivate: focus-trap-react snapshots onDeactivate at first mount
  // and invokes it on every trap teardown, including the unmount that
  // happens when Retry/Discard flips showPendingSendError to false. Per-event
  // predicates run with the latest closure (or in our case, with stable refs
  // that always read live state).
  const [deferredErrorMessage, setDeferredErrorMessage] = useState<string | undefined>();
  const {
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
  } = useVoiceRecorder({
    onRecordingStart,
    onSendStopRequest,
    onSendStopFailure,
    onSendRecording,
    getSendContext,
  });
  const displayErrorMessage = localizeVoiceErrorMessage(t, errorMessage);

  const errorMessageRef = useRef(errorMessage);
  useEffect(() => {
    errorMessageRef.current = errorMessage;
  }, [errorMessage]);

  const discardAndClose = () => {
    if (hasPendingSend) {
      setDiscardConfirmationOpen(true);
      return;
    }

    void (async () => {
      await discard();
      onClose();
    })();
  };

  // Any user-initiated retry must clear an existing defer so a follow-up
  // failure with the same canonical message (very common: connection-dropped)
  // re-surfaces the overlay rather than getting silently hidden.
  const beginRetry = useCallback((): Promise<boolean> => {
    setDeferredErrorMessage(undefined);
    return retry();
  }, [retry]);

  const submitRecording = useCallback(async (): Promise<boolean> => {
    if (sendDisabled) return false;

    const sent = hasPendingSend ? await beginRetry() : await send();
    if (sent) {
      onClose();
    }
    return sent;
  }, [beginRetry, hasPendingSend, onClose, send, sendDisabled]);

  useImperativeHandle(ref, () => ({ send: submitRecording }), [submitRecording]);

  const confirmDiscardAndClose = () => {
    discardPending();
    setDiscardConfirmationOpen(false);
    onClose();
  };

  const dismissError = () => {
    clearError();
    onClose();
  };

  useEffect(() => {
    if (!active) {
      autoStartTriggeredRef.current = false;
      if (!hasPendingSend) {
        reset();
        // The component returns null below in this state but useState is
        // preserved across null renders, so deferredErrorMessage would
        // outlive a recording session. Reset it here so a brand-new
        // recording that fails with the same canonical message still
        // surfaces the failure overlay.
        setDeferredErrorMessage(undefined);
      }
      return;
    }

    if (autoStartTriggeredRef.current) return;
    autoStartTriggeredRef.current = true;
    void start();
  }, [active, hasPendingSend, reset, start]);

  if (!active && !errorMessage && !hasPendingSend) {
    return null;
  }

  const showPendingSendError =
    !!errorMessage &&
    hasPendingSend &&
    !discardConfirmationOpen &&
    errorMessage !== deferredErrorMessage;
  const showNoBlobError = !!errorMessage && !hasPendingSend;

  // captureDeferDismiss reads errorMessage via errorMessageRef declared
  // below so the per-event predicate (captured by focus-trap-react at first
  // mount) always sees live state.
  const captureDeferDismiss = (): boolean => {
    if (errorMessageRef.current) {
      setDeferredErrorMessage(errorMessageRef.current);
    }
    return true;
  };

  return (
    <>
      <Overlay open={showPendingSendError} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              // Backdrop click and Escape key dismiss the overlay without
              // discarding the draft. The capsule remains visible so the user
              // can defer the retry/discard decision. Both signals come from
              // PER-EVENT predicates so they only fire on actual user-defer
              // intent — NOT on the trap-teardown that happens when Retry or
              // Discard flips showPendingSendError to false. (Earlier
              // revisions used onDeactivate, which focus-trap-react snapshots
              // at first mount and invokes on every teardown — that
              // mis-deferred valid Retry / Discard transitions.)
              clickOutsideDeactivates: captureDeferDismiss,
              escapeDeactivates: (event) => {
                // stopPropagation returns false when an editable element has
                // focus inside the trap — in that case keep the trap and let
                // the editable own the Escape.
                if (!stopPropagation(event)) return false;
                return captureDeferDismiss();
              },
            }}
          >
            {/* div lets FocusTrap attach its ref even when Dialog is a
                non-forwardRef function component (folds Dialog supports
                refs in production but the test mock doesn't). */}
            <div>
              <Dialog variant="Surface">
                <Box
                  direction="Column"
                  gap="300"
                  style={{ padding: config.space.S400, maxWidth: 360 }}
                >
                  <Text size="H5">{t('mindroomUi.voice.voiceRecorderDialog.voiceSendFailed')}</Text>
                  <Box direction="Column" gap="100">
                    <Text size="T300">{displayErrorMessage}</Text>
                    <Text size="T300">
                      {t('mindroomUi.voice.voiceRecorderDialog.yourRecordingIsStillSaved')}
                    </Text>
                  </Box>
                  <Box justifyContent="End" gap="200">
                    <Button
                      variant="Secondary"
                      onClick={() => setDiscardConfirmationOpen(true)}
                      fill="Soft"
                      outlined
                      radii="300"
                    >
                      {t('mindroomUi.voice.voiceRecorderDialog.discard')}
                    </Button>
                    <Button
                      variant="Primary"
                      onClick={onRetryRequest}
                      fill="Soft"
                      outlined
                      radii="300"
                    >
                      {t('mindroomUi.voice.voiceRecorderDialog.retry')}
                    </Button>
                  </Box>
                </Box>
              </Dialog>
            </div>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>

      <Overlay open={discardConfirmationOpen} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <Dialog variant="Surface">
            <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
              <Text size="H5">
                {t('mindroomUi.voice.voiceRecorderDialog.discardVoiceRecording')}
              </Text>
              <Text size="T300">
                {t(
                  'mindroomUi.voice.voiceRecorderDialog.thisRecordingHasNotBeenSentDiscardItPermanently'
                )}
              </Text>
              <Box justifyContent="End" gap="200">
                <Button
                  variant="Secondary"
                  onClick={() => setDiscardConfirmationOpen(false)}
                  fill="Soft"
                  outlined
                  radii="300"
                >
                  {t('mindroomUi.voice.voiceRecorderDialog.cancel')}
                </Button>
                <Button
                  variant="Critical"
                  onClick={confirmDiscardAndClose}
                  fill="Soft"
                  outlined
                  radii="300"
                >
                  {t('mindroomUi.voice.voiceRecorderDialog.discard')}
                </Button>
              </Box>
            </Box>
          </Dialog>
        </OverlayCenter>
      </Overlay>

      <Overlay open={showNoBlobError} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <Dialog variant="Surface">
            <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
              <Text size="H5">{t('mindroomUi.voice.voiceRecorderDialog.voiceRecordingError')}</Text>
              <Text size="T300">{displayErrorMessage}</Text>
              <Box justifyContent="End" gap="200">
                <Button variant="Primary" onClick={dismissError} fill="Soft" outlined radii="300">
                  {t('mindroomUi.voice.voiceRecorderDialog.ok')}
                </Button>
              </Box>
            </Box>
          </Dialog>
        </OverlayCenter>
      </Overlay>

      {(active || hasPendingSend) && (
        <div>
          <Line variant="SurfaceVariant" size="300" />
          <Box style={{ padding: `${config.space.S200} ${config.space.S300}` }}>
            <VoiceRecordingCapsule
              phase={phase}
              elapsedMs={hasPendingSend ? pendingDuration : elapsedMs}
              waveform={hasPendingSend ? pendingWaveform : waveform}
              canPause={canPause}
              hasPendingSend={hasPendingSend}
              onDiscard={discardAndClose}
              onPause={pause}
              onResume={resume}
            />
          </Box>
        </div>
      )}
    </>
  );
};

export const VoiceRecorderComposer = forwardRef(VoiceRecorderComposerRender);
