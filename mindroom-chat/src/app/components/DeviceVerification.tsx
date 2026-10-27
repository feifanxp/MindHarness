import { useTranslation } from 'react-i18next';
import {
  ShowSasCallbacks,
  VerificationPhase,
  VerificationRequest,
  Verifier,
} from 'matrix-js-sdk/lib/crypto-api';
import React, { CSSProperties, useCallback, useEffect, useState } from 'react';
import { VerificationMethod } from 'matrix-js-sdk/lib/types';
import {
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { Dialog, Header } from './glass/GlassPrimitives';
import {
  useVerificationRequestPhase,
  useVerificationRequestReceived,
  useVerifierCancel,
  useVerifierShowSas,
} from '../hooks/useVerificationRequest';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { ContainerColor } from '../styles/ContainerColor.css';

const DialogHeaderStyles: CSSProperties = {
  padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
  borderBottomWidth: config.borderWidth.B300,
};

type WaitingMessageProps = {
  message: string;
};
function WaitingMessage({ message }: WaitingMessageProps) {
  return (
    <Box alignItems="Center" gap="200">
      <Spinner variant="Secondary" size="200" />
      <Text size="T300">{message}</Text>
    </Box>
  );
}

type VerificationUnexpectedProps = { message: string; onClose: () => void };
function VerificationUnexpected({ message, onClose }: VerificationUnexpectedProps) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="400">
      <Text>{message}</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose} outlined radii="300">
        <Text size="B400">{t('sharedUi.deviceVerification.close')}</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitAccept() {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="400">
      <Text>{t('sharedUi.deviceVerification.pleaseAcceptTheRequestFromOtherDevice')}</Text>
      <WaitingMessage message={t('sharedUi.deviceVerification.waitingForRequestToBeAccepted')} />
    </Box>
  );
}

type VerificationAcceptProps = {
  onAccept: () => Promise<void>;
};
function VerificationAccept({ onAccept }: VerificationAcceptProps) {
  const { t } = useTranslation();
  const [acceptState, accept] = useAsyncCallback(onAccept);

  const accepting = acceptState.status === AsyncStatus.Loading;
  return (
    <Box direction="Column" gap="400">
      <Text>{t('sharedUi.deviceVerification.clickAcceptToStartTheVerificationProcess')}</Text>
      <Button
        variant="Primary"
        fill="Soft"
        onClick={accept}
        before={accepting && <Spinner size="100" variant="Primary" fill="Soft" />}
        disabled={accepting}
        outlined
        radii="300"
      >
        <Text size="B400">{t('sharedUi.deviceVerification.accept')}</Text>
      </Button>
    </Box>
  );
}

function VerificationWaitStart() {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="400">
      <Text>{t('sharedUi.deviceVerification.verificationRequestHasBeenAccepted')}</Text>
      <WaitingMessage
        message={t('sharedUi.deviceVerification.waitingForTheResponseFromOtherDevice')}
      />
    </Box>
  );
}

type VerificationStartProps = {
  onStart: () => Promise<void>;
};
function AutoVerificationStart({ onStart }: VerificationStartProps) {
  const { t } = useTranslation();
  useEffect(() => {
    onStart();
  }, [onStart]);

  return (
    <Box direction="Column" gap="400">
      <WaitingMessage
        message={t('sharedUi.deviceVerification.startingVerificationUsingEmojiComparison')}
      />
    </Box>
  );
}

function CompareEmoji({ sasData }: { sasData: ShowSasCallbacks }) {
  const { t } = useTranslation();
  const [confirmState, confirm] = useAsyncCallback(useCallback(() => sasData.confirm(), [sasData]));

  const confirming =
    confirmState.status === AsyncStatus.Loading || confirmState.status === AsyncStatus.Success;

  return (
    <Box direction="Column" gap="400">
      <Text>
        {t('sharedUi.deviceVerification.confirmTheEmojiBelowAreDisplayedOnBothDevicesInTheSame')}
      </Text>
      <Box
        className={ContainerColor({ variant: 'SurfaceVariant' })}
        style={{
          borderRadius: config.radii.R400,
          padding: config.space.S500,
        }}
        gap="700"
        wrap="Wrap"
        justifyContent="Center"
      >
        {sasData.sas.emoji?.map(([emoji, name], index) => (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={`${emoji}${name}${index}`}
            direction="Column"
            gap="100"
            justifyContent="Center"
            alignItems="Center"
          >
            <Text size="H1">{emoji}</Text>
            <Text size="T200">{name}</Text>
          </Box>
        ))}
      </Box>
      <Box direction="Column" gap="200">
        <Button
          variant="Primary"
          fill="Soft"
          onClick={confirm}
          disabled={confirming}
          before={confirming && <Spinner size="100" variant="Primary" />}
          outlined
          radii="300"
        >
          <Text size="B400">{t('sharedUi.deviceVerification.theyMatch')}</Text>
        </Button>
        <Button
          variant="Primary"
          fill="Soft"
          onClick={() => sasData.mismatch()}
          disabled={confirming}
          outlined
          radii="300"
        >
          <Text size="B400">{t('sharedUi.deviceVerification.doNotMatch')}</Text>
        </Button>
      </Box>
    </Box>
  );
}

type SasVerificationProps = {
  verifier: Verifier;
  onCancel: () => void;
};
function SasVerification({ verifier, onCancel }: SasVerificationProps) {
  const { t } = useTranslation();
  const [sasData, setSasData] = useState<ShowSasCallbacks>();

  useVerifierShowSas(verifier, setSasData);
  useVerifierCancel(verifier, onCancel);

  useEffect(() => {
    verifier.verify();
  }, [verifier]);

  if (sasData) {
    return <CompareEmoji sasData={sasData} />;
  }

  return (
    <Box direction="Column" gap="400">
      <WaitingMessage
        message={t('sharedUi.deviceVerification.startingVerificationUsingEmojiComparison')}
      />
    </Box>
  );
}

type VerificationDoneProps = {
  onExit: () => void;
};
function VerificationDone({ onExit }: VerificationDoneProps) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="400">
      <div>
        <Text>{t('sharedUi.deviceVerification.yourDeviceIsVerified')}</Text>
      </div>
      <Button variant="Primary" fill="Soft" onClick={onExit} outlined radii="300">
        <Text size="B400">{t('sharedUi.deviceVerification.okay')}</Text>
      </Button>
    </Box>
  );
}

type VerificationCanceledProps = {
  onClose: () => void;
};
function VerificationCanceled({ onClose }: VerificationCanceledProps) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="400">
      <Text>{t('sharedUi.deviceVerification.verificationHasBeenCanceled')}</Text>
      <Button variant="Secondary" fill="Soft" onClick={onClose} outlined radii="300">
        <Text size="B400">{t('sharedUi.deviceVerification.close')}</Text>
      </Button>
    </Box>
  );
}

type DeviceVerificationProps = {
  request: VerificationRequest;
  onExit: () => void;
};
export function DeviceVerification({ request, onExit }: DeviceVerificationProps) {
  const { t } = useTranslation();
  const phase = useVerificationRequestPhase(request);

  const handleCancel = useCallback(() => {
    if (request.phase !== VerificationPhase.Done && request.phase !== VerificationPhase.Cancelled) {
      request.cancel();
    }
    onExit();
  }, [request, onExit]);

  const handleAccept = useCallback(() => request.accept(), [request]);
  const handleStart = useCallback(async () => {
    await request.startVerification(VerificationMethod.Sas);
  }, [request]);

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: false,
            escapeDeactivates: false,
          }}
        >
          <Dialog variant="Surface">
            <Header style={DialogHeaderStyles} variant="Surface" size="500">
              <Box grow="Yes">
                <Text size="H4">{t('sharedUi.deviceVerification.deviceVerification')}</Text>
              </Box>
              <IconButton size="300" radii="300" onClick={handleCancel}>
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
              {phase === VerificationPhase.Requested &&
                (request.initiatedByMe ? (
                  <VerificationWaitAccept />
                ) : (
                  <VerificationAccept onAccept={handleAccept} />
                ))}
              {phase === VerificationPhase.Ready &&
                (request.initiatedByMe ? (
                  <AutoVerificationStart onStart={handleStart} />
                ) : (
                  <VerificationWaitStart />
                ))}
              {phase === VerificationPhase.Started &&
                (request.verifier ? (
                  <SasVerification verifier={request.verifier} onCancel={handleCancel} />
                ) : (
                  <VerificationUnexpected
                    message={t(
                      'sharedUi.deviceVerification.unexpectedErrorVerificationIsStartedButVerifierIsMissing'
                    )}
                    onClose={handleCancel}
                  />
                ))}
              {phase === VerificationPhase.Done && <VerificationDone onExit={onExit} />}
              {phase === VerificationPhase.Cancelled && (
                <VerificationCanceled onClose={handleCancel} />
              )}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ReceiveSelfDeviceVerification() {
  const [request, setRequest] = useState<VerificationRequest>();

  useVerificationRequestReceived(setRequest);

  const handleExit = useCallback(() => {
    setRequest(undefined);
  }, []);

  if (!request) return null;

  if (!request.isSelfVerification) {
    return null;
  }

  return <DeviceVerification request={request} onExit={handleExit} />;
}
