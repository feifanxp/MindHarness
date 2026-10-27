import { useTranslation } from 'react-i18next';
import React, { useEffect, useCallback, FormEventHandler } from 'react';
import { Text, Box, Button, config, Input } from 'folds';
import { AuthType } from 'matrix-js-sdk';
import { Dialog } from '../glass/GlassPrimitives';
import { StageComponentProps } from './types';

function RegistrationTokenErrorDialog({
  title,
  message,
  defaultToken,
  onRetry,
  onCancel,
}: {
  title: string;
  message: string;
  defaultToken?: string;
  onRetry: (token: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const handleFormSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const { retryTokenInput } = evt.target as HTMLFormElement & {
      retryTokenInput: HTMLInputElement;
    };
    const t = retryTokenInput.value;
    onRetry(t);
  };

  return (
    <Dialog>
      <Box
        as="form"
        onSubmit={handleFormSubmit}
        style={{ padding: config.space.S400 }}
        direction="Column"
        gap="400"
      >
        <Box direction="Column" gap="100">
          <Text size="H4">{title}</Text>
          <Text>{message}</Text>
          <Text as="label" size="L400" style={{ paddingTop: config.space.S400 }}>
            {t('sharedUi.registrationTokenStage.registrationToken')}
          </Text>
          <Input
            name="retryTokenInput"
            variant="Background"
            size="500"
            outlined
            defaultValue={defaultToken}
            required
          />
        </Box>
        <Button variant="Critical" type="submit" fill="Soft" outlined radii="300">
          <Text as="span" size="B400">
            {t('sharedUi.registrationTokenStage.retry')}
          </Text>
        </Button>
        <Button variant="Critical" fill="None" outlined type="button" onClick={onCancel}>
          <Text as="span" size="B400">
            {t('sharedUi.registrationTokenStage.cancel')}
          </Text>
        </Button>
      </Box>
    </Dialog>
  );
}

export function RegistrationTokenStageDialog({
  token,
  stageData,
  submitAuthDict,
  onCancel,
}: StageComponentProps & {
  token?: string;
}) {
  const { t } = useTranslation();
  const { errorCode, error, session } = stageData;

  const handleSubmit = useCallback(
    (t: string) => {
      submitAuthDict({
        type: AuthType.RegistrationToken,
        token: t,
        session,
      });
    },
    [session, submitAuthDict]
  );

  useEffect(() => {
    if (token && !errorCode) handleSubmit(token);
  }, [handleSubmit, token, errorCode]);

  if (errorCode) {
    return (
      <RegistrationTokenErrorDialog
        defaultToken={token}
        title={errorCode}
        message={error ?? t('sharedUi.registrationTokenStage.invalidRegistrationTokenProvided')}
        onRetry={handleSubmit}
        onCancel={onCancel}
      />
    );
  }

  if (!token) {
    return (
      <RegistrationTokenErrorDialog
        defaultToken={token}
        title={t('sharedUi.registrationTokenStage.registrationToken')}
        message={t(
          'sharedUi.registrationTokenStage.pleaseSubmitRegistrationTokenProvidedByYouHomeserverAdmin'
        )}
        onRetry={handleSubmit}
        onCancel={onCancel}
      />
    );
  }

  return null;
}
