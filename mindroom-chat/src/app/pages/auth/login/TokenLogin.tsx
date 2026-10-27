import { useTranslation } from 'react-i18next';
import {
  Box,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import React, { useCallback, useEffect } from 'react';
import { MatrixError } from 'matrix-js-sdk';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { CustomLoginResponse, LoginError, login, useLoginComplete } from './loginUtil';
import { MINDROOM_AUTH_BRANDING } from '../../../mindroom/auth/authUi';

function LoginTokenError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        backgroundColor: color.Critical.Container,
        color: color.Critical.OnContainer,
        padding: config.space.S300,
        borderRadius: config.radii.R400,
      }}
      justifyContent="Start"
      alignItems="Start"
      gap="300"
    >
      <Icon size="300" filled src={Icons.Warning} />
      <Box direction="Column" gap="100">
        <Text size="L400">{t('sharedUi.tokenLogin.tokenLogin')}</Text>
        <Text size="T300">
          <b>{message}</b>
        </Text>
      </Box>
    </Box>
  );
}

type TokenLoginProps = {
  token: string;
};
export function TokenLogin({ token }: TokenLoginProps) {
  const { t } = useTranslation();
  const discovery = useAutoDiscoveryInfo();
  const baseUrl = discovery['m.homeserver'].base_url;

  const [loginState, startLogin] = useAsyncCallback<
    CustomLoginResponse,
    MatrixError,
    Parameters<typeof login>
  >(useCallback(login, []));

  useEffect(() => {
    startLogin(baseUrl, {
      type: 'm.login.token',
      token,
      initial_device_display_name: MINDROOM_AUTH_BRANDING.deviceDisplayName,
    });
  }, [baseUrl, token, startLogin]);

  const sessionStoreError = useLoginComplete(
    loginState.status === AsyncStatus.Success ? loginState.data : undefined
  );

  return (
    <>
      {loginState.status === AsyncStatus.Error && (
        <>
          {loginState.error.errcode === LoginError.Forbidden && (
            <LoginTokenError message={t('sharedUi.tokenLogin.invalidLoginToken')} />
          )}
          {loginState.error.errcode === LoginError.UserDeactivated && (
            <LoginTokenError message={t('sharedUi.tokenLogin.thisAccountHasBeenDeactivated')} />
          )}
          {loginState.error.errcode === LoginError.InvalidRequest && (
            <LoginTokenError
              message={t('sharedUi.tokenLogin.failedToLoginPartOfYourRequestDataIsInvalid')}
            />
          )}
          {loginState.error.errcode === LoginError.RateLimited && (
            <LoginTokenError
              message={t(
                'sharedUi.tokenLogin.failedToLoginYourLoginRequestHasBeenRateLimitedByServer'
              )}
            />
          )}
          {loginState.error.errcode === LoginError.Unknown && (
            <LoginTokenError message={t('sharedUi.tokenLogin.failedToLoginUnknownReason')} />
          )}
        </>
      )}
      {sessionStoreError && (
        <LoginTokenError
          message={t(
            'sharedUi.tokenLogin.loginSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
          )}
        />
      )}
      <Overlay
        open={loginState.status !== AsyncStatus.Error && !sessionStoreError}
        backdrop={<OverlayBackdrop />}
      >
        <OverlayCenter>
          <Spinner size="600" variant="Secondary" />
        </OverlayCenter>
      </Overlay>
    </>
  );
}
