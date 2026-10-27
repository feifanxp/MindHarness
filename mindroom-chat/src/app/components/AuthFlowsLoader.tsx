import { useTranslation } from 'react-i18next';
import React, { ReactNode, useCallback, useEffect, useMemo } from 'react';
import { Box, Button, Text, color } from 'folds';
import { MatrixError } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { useAutoDiscoveryInfo } from '../hooks/useAutoDiscoveryInfo';
import { promiseFulfilledResult, promiseRejectedResult } from '../utils/common';
import {
  AuthFlows,
  RegisterFlowStatus,
  RegisterFlowsResponse,
  parseRegisterErrResp,
} from '../hooks/useAuthFlows';
import { createMatrixClient } from '../mindroom/matrix/matrixClientFactory';

type AuthFlowsLoaderProps = {
  fallback?: () => ReactNode;
  error?: (err: unknown) => ReactNode;
  children: (authFlows: AuthFlows) => ReactNode;
};
export function AuthFlowsLoader({ fallback, error, children }: AuthFlowsLoaderProps) {
  const { t } = useTranslation();
  const autoDiscoveryInfo = useAutoDiscoveryInfo();
  const baseUrl = autoDiscoveryInfo['m.homeserver'].base_url;

  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);

  const [state, load] = useAsyncCallback(
    useCallback(async () => {
      const result = await Promise.allSettled([mx.loginFlows(), mx.registerRequest({})]);
      const loginFlows = promiseFulfilledResult(result[0]);
      const registerResp = promiseRejectedResult(result[1]) as MatrixError | undefined;
      let registerFlows: RegisterFlowsResponse = { status: RegisterFlowStatus.InvalidRequest };

      if (typeof registerResp === 'object' && registerResp.httpStatus) {
        registerFlows = parseRegisterErrResp(registerResp);
      }

      if (!loginFlows) {
        throw new Error('Login flows unavailable.');
      }
      if ('errcode' in loginFlows) {
        throw new Error('Login flows returned an error.');
      }

      const authFlows: AuthFlows = {
        loginFlows,
        registerFlows,
      };

      return authFlows;
    }, [mx])
  );

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const handleRetry = useCallback(() => {
    load().catch(() => undefined);
  }, [load]);

  if (state.status === AsyncStatus.Idle || state.status === AsyncStatus.Loading) {
    return fallback?.();
  }

  if (state.status === AsyncStatus.Error) {
    return (
      <Box justifyContent="Center" alignItems="Center" direction="Column" gap="200">
        {error ? (
          error(state.error)
        ) : (
          <Text align="Center" style={{ color: color.Critical.Main }} size="T300">
            {t('sharedUi.authFlowsLoader.failedToLoadAuthenticationFlowInformation')}
          </Text>
        )}
        <Button
          variant="Secondary"
          size="400"
          onClick={handleRetry}
          fill="Soft"
          outlined
          radii="300"
        >
          {t('sharedUi.authFlowsLoader.retry')}
        </Button>
      </Box>
    );
  }

  return children(state.data);
}
