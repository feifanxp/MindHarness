import { useCallback, useEffect, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { SpecVersions, specVersions } from '../cs-api';

type SpecVersionsLoaderProps = {
  baseUrl: string;
  request?: typeof fetch;
  fallback?: () => JSX.Element | null;
  error?: (err: unknown, retry: () => void, ignore: () => void) => JSX.Element | null;
  children: (versions: SpecVersions) => JSX.Element | null;
};
export function SpecVersionsLoader({
  baseUrl,
  request = fetch,
  fallback,
  error,
  children,
}: SpecVersionsLoaderProps): JSX.Element | null {
  const [state, load] = useAsyncCallback(
    useCallback(() => specVersions(request, baseUrl), [baseUrl, request])
  );
  const [ignoreError, setIgnoreError] = useState(false);

  const ignoreCallback = useCallback(() => setIgnoreError(true), []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === AsyncStatus.Idle || state.status === AsyncStatus.Loading) {
    return fallback?.() ?? null;
  }

  if (!ignoreError && state.status === AsyncStatus.Error) {
    return error?.(state.error, load, ignoreCallback) ?? null;
  }

  return children(
    state.status === AsyncStatus.Success
      ? state.data
      : {
          versions: [],
        }
  );
}
