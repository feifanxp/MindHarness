import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAlive } from './useAlive';

export enum AsyncStatus {
  Idle = 'idle',
  Loading = 'loading',
  Success = 'success',
  Error = 'error',
}

export type AsyncIdle = {
  status: AsyncStatus.Idle;
};

export type AsyncLoading = {
  status: AsyncStatus.Loading;
};

export type AsyncSuccess<D> = {
  status: AsyncStatus.Success;
  data: D;
};

export type AsyncError<E = unknown> = {
  status: AsyncStatus.Error;
  error: E;
};

export type AsyncState<D, E = unknown> = AsyncIdle | AsyncLoading | AsyncSuccess<D> | AsyncError<E>;

export type AsyncCallback<TArgs extends unknown[], TData> = (...args: TArgs) => Promise<TData>;
export type AsyncDiscardCallback<TData> = (data: TData) => void;
type AsyncStateChangeCallback<TData, TError> = (
  state: AsyncState<TData, TError>
) => void | Promise<void>;

type PendingSuccess<TData> = {
  state: AsyncSuccess<TData>;
  data: TData;
  discard: AsyncDiscardCallback<TData>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};
type PendingSuccessSettlement = 'replacement' | 'unmount';

export const useAsync = <TData, TError, TArgs extends unknown[]>(
  asyncCallback: AsyncCallback<TArgs, TData>,
  onStateChange: AsyncStateChangeCallback<TData, TError>,
  onDiscard?: AsyncDiscardCallback<TData>
): AsyncCallback<TArgs, TData> => {
  const alive = useAlive();

  // Tracks the request number.
  // If two or more requests are made subsequently
  // we will throw all old request's response after they resolved.
  const reqNumberRef = useRef(0);

  const callback: AsyncCallback<TArgs, TData> = useCallback(
    async (...args) => {
      queueMicrotask(() => {
        // Warning: flushSync was called from inside a lifecycle method.
        // React cannot flush when React is already rendering.
        // Consider moving this call to a scheduler task or micro task.
        flushSync(() => {
          // flushSync because
          // https://github.com/facebook/react/issues/26713#issuecomment-1872085134
          onStateChange({
            status: AsyncStatus.Loading,
          });
        });
      });

      reqNumberRef.current += 1;

      const currentReqNumber = reqNumberRef.current;
      try {
        const data = await asyncCallback(...args);

        await new Promise<void>((resolve, reject) => {
          queueMicrotask(() => {
            try {
              if (currentReqNumber !== reqNumberRef.current) {
                onDiscard?.(data);
                reject(new Error('AsyncCallbackHook: Request replaced!'));
                return;
              }
              if (!alive()) {
                onDiscard?.(data);
                resolve();
                return;
              }

              const publication = onStateChange({
                status: AsyncStatus.Success,
                data,
              });
              if (publication) {
                publication.then(resolve, reject);
              } else {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        return data;
      } catch (e) {
        await new Promise<void>((resolve, reject) => {
          queueMicrotask(() => {
            try {
              if (currentReqNumber !== reqNumberRef.current) {
                reject(new Error('AsyncCallbackHook: Request replaced!'));
                return;
              }
              if (!alive()) {
                resolve();
                return;
              }

              const publication = onStateChange({
                status: AsyncStatus.Error,
                error: e as TError,
              });
              if (publication) {
                publication.then(resolve, reject);
              } else {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });
        throw e;
      }
    },
    [asyncCallback, alive, onDiscard, onStateChange]
  );

  return callback;
};

export const useAsyncCallback = <TData, TError, TArgs extends unknown[]>(
  asyncCallback: AsyncCallback<TArgs, TData>,
  onDiscard?: AsyncDiscardCallback<TData>
): [AsyncState<TData, TError>, AsyncCallback<TArgs, TData>] => {
  const [state, setState] = useState<AsyncState<TData, TError>>({
    status: AsyncStatus.Idle,
  });
  const onDiscardRef = useRef(onDiscard);
  const pendingSuccessRef = useRef<PendingSuccess<TData>>();
  onDiscardRef.current = onDiscard;

  const settlePendingSuccess = useCallback((reason: PendingSuccessSettlement) => {
    const pending = pendingSuccessRef.current;
    if (!pending) return;

    pendingSuccessRef.current = undefined;
    try {
      pending.discard(pending.data);
      if (reason === 'replacement') {
        pending.reject(new Error('AsyncCallbackHook: Request replaced!'));
      } else {
        pending.resolve();
      }
    } catch (error) {
      pending.reject(error);
    }
  }, []);

  const publishState: AsyncStateChangeCallback<TData, TError> = useCallback(
    (nextState) => {
      const discard = onDiscardRef.current;
      if (nextState.status !== AsyncStatus.Success || !discard) {
        setState(nextState);
        return;
      }

      return new Promise<void>((resolve, reject) => {
        settlePendingSuccess('replacement');
        pendingSuccessRef.current = {
          state: nextState,
          data: nextState.data,
          discard,
          resolve,
          reject,
        };
        setState(nextState);
      });
    },
    [settlePendingSuccess]
  );

  const discardResolved = useCallback((data: TData) => {
    onDiscardRef.current?.(data);
  }, []);
  const callback = useAsync(asyncCallback, publishState, discardResolved);
  const load: AsyncCallback<TArgs, TData> = useCallback(
    (...args) => {
      settlePendingSuccess('replacement');
      return callback(...args);
    },
    [callback, settlePendingSuccess]
  );

  useLayoutEffect(
    () => () => {
      settlePendingSuccess('unmount');
    },
    [settlePendingSuccess]
  );

  useEffect(() => {
    const pending = pendingSuccessRef.current;
    if (state.status === AsyncStatus.Success && pending?.state === state) {
      pendingSuccessRef.current = undefined;
      pending.resolve();
    }
  }, [state]);

  return [state, load];
};

export const useAsyncCallbackValue = <TData, TError>(
  asyncCallback: AsyncCallback<[], TData>
): [AsyncState<TData, TError>, AsyncCallback<[], TData>] => {
  const [state, load] = useAsyncCallback<TData, TError, []>(asyncCallback);

  useEffect(() => {
    load();
  }, [load]);

  return [state, load];
};
