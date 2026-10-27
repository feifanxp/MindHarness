import { useSyncExternalStore } from 'react';
import { getIOSPushEnabled, subscribeToIOSPushState } from './iosPush';

export const useIOSPushEnabled = (sessionId?: string): boolean =>
  useSyncExternalStore(
    subscribeToIOSPushState,
    () => getIOSPushEnabled(sessionId),
    () => getIOSPushEnabled(sessionId)
  );
