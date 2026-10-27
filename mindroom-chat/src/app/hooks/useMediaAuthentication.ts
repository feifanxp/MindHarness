import { useSyncExternalStore } from 'react';
import type { SpecVersions } from '../cs-api';
import { isServiceWorkerEnabled } from '../utils/runtimeConfig';
import { useSpecVersions } from './useSpecVersions';

import { supportsAuthenticatedMedia } from '../utils/mediaUrl';

const hasServiceWorkerMediaAuthSupport = (): boolean =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  isServiceWorkerEnabled() &&
  Boolean(navigator.serviceWorker?.controller);

const subscribeToServiceWorkerControl = (listener: () => void): (() => void) => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const { serviceWorker } = navigator;
  serviceWorker.addEventListener('controllerchange', listener);
  return () => serviceWorker.removeEventListener('controllerchange', listener);
};

// Capacitor iOS WebViews run on `capacitor://` and do not expose service workers,
// but we can still use authenticated media endpoints via token-in-query fallback.
export const hasCapacitorMediaAuthSupport = (
  protocol: string | undefined = typeof window !== 'undefined'
    ? window.location?.protocol
    : undefined
): boolean => protocol === 'capacitor:';

export const hasMediaAuthTransportSupport = (
  serviceWorkerAvailable: boolean,
  capacitorAvailable: boolean = hasCapacitorMediaAuthSupport()
): boolean => serviceWorkerAvailable || capacitorAvailable;

export const shouldUseMediaAuthentication = (
  specVersions: SpecVersions,
  mediaAuthTransportAvailable: boolean
): boolean => supportsAuthenticatedMedia(specVersions) && mediaAuthTransportAvailable;

export const useMediaAuthentication = (): boolean => {
  const serviceWorkerAvailable = useSyncExternalStore(
    subscribeToServiceWorkerControl,
    hasServiceWorkerMediaAuthSupport,
    () => false
  );
  return shouldUseMediaAuthentication(
    useSpecVersions(),
    hasMediaAuthTransportSupport(serviceWorkerAvailable)
  );
};
