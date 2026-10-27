import React, { ReactNode, useCallback, useMemo } from 'react';
import type { Capabilities } from 'matrix-js-sdk/lib/serverCapabilities';
import {
  validateAuthMetadata,
  type ValidatedAuthMetadata,
} from 'matrix-js-sdk/lib/oidc/validate';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import type { MediaConfig } from '../hooks/useMediaConfig';
import { promiseFulfilledResult } from '../utils/common';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
};

type ServerConfigClient = {
  getCapabilities: () => Promise<Capabilities>;
  getMediaConfig: () => Promise<MediaConfig>;
  getAuthMetadata: () => Promise<unknown>;
};

type ServerConfigsLoaderProps = {
  mx: ServerConfigClient;
  children: (configs: ServerConfigs) => ReactNode;
};

export function ServerConfigsLoader({ mx, children }: ServerConfigsLoaderProps) {
  const fallbackConfigs = useMemo(() => ({}), []);

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(async () => {
      const result = await Promise.allSettled([
        mx.getCapabilities(),
        mx.getMediaConfig(),
        mx.getAuthMetadata(),
      ]);

      const capabilities = promiseFulfilledResult(result[0]);
      const mediaConfig = promiseFulfilledResult(result[1]);
      const authMetadata = promiseFulfilledResult(result[2]);
      let validatedAuthMetadata: ValidatedAuthMetadata | undefined;

      if (authMetadata !== undefined) {
        try {
          validatedAuthMetadata = validateAuthMetadata(authMetadata);
        } catch (e) {
          console.error(e);
        }
      }

      return {
        capabilities,
        mediaConfig,
        authMetadata: validatedAuthMetadata,
      };
    }, [mx])
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return React.createElement(React.Fragment, null, children(configs));
}
