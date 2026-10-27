import { useCallback, useSyncExternalStore } from 'react';
import { MatrixEventEvent, type EventStatus, type MatrixEvent } from 'matrix-js-sdk';

/**
 * A local echo's send status, read again on every SDK status change of that object.
 * Hold the echo itself: the SDK forgets its transaction ID once the server's copy arrives.
 * Undefined without an echo.
 */
export const useLocalEchoStatus = (echo?: MatrixEvent): EventStatus | null | undefined => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      echo?.on(MatrixEventEvent.Status, onChange);
      return () => {
        echo?.off(MatrixEventEvent.Status, onChange);
      };
    },
    [echo]
  );
  return useSyncExternalStore(subscribe, () => (echo ? echo.status : undefined));
};
