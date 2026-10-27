import { useStore } from 'jotai';
import { useCallback } from 'react';
import { resolvePrefetchConfig, type PrefetchConfig } from '../engine';
import { mindroomSettingsAtom } from './mindroomSettings';

/** Read prefetch settings from the Jotai Provider that owns the mounted app. */
export const useLivePrefetchConfig = (): (() => PrefetchConfig) => {
  const store = useStore();

  return useCallback(() => resolvePrefetchConfig(store.get(mindroomSettingsAtom)), [store]);
};

/** Subscribe the client-owned sync engine to live prefetch scope changes. */
export const usePrefetchConfigSubscription = (): ((listener: () => void) => () => void) => {
  const store = useStore();
  return useCallback((listener) => store.sub(mindroomSettingsAtom, listener), [store]);
};
