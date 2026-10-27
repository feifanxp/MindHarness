import { useEffect, useState } from 'react';
import type { CallFailureNotice } from './useCallFailureNotice';

type CallFailureDismissal = {
  dismissFailure: () => void;
  visibleFailure: CallFailureNotice | undefined;
};

export const useCallFailureDismissal = (
  joined: boolean,
  failure: CallFailureNotice | undefined
): CallFailureDismissal => {
  const [dismissedEventId, setDismissedEventId] = useState<string>();

  useEffect(() => {
    if (!joined) setDismissedEventId(undefined);
  }, [joined]);

  return {
    dismissFailure: () => {
      if (failure) setDismissedEventId(failure.eventId);
    },
    visibleFailure: failure?.eventId !== dismissedEventId ? failure : undefined,
  };
};
