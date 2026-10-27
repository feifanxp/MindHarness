import React, { useEffect } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { mindroomSettingsAtom } from './mindroomSettings';
import { useLivePrefetchConfig, usePrefetchConfigSubscription } from './useLivePrefetchConfig';

describe('useLivePrefetchConfig', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => renderer?.unmount());

  it('reads live settings from the current Jotai provider store', () => {
    const store = createStore();
    let readConfig: ReturnType<typeof useLivePrefetchConfig> | undefined;

    const Probe = () => {
      const reader = useLivePrefetchConfig();
      useEffect(() => {
        readConfig = reader;
      }, [reader]);
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });

    expect(readConfig?.()).toEqual({ scope: 'current-room-only' });

    act(() => {
      store.set(mindroomSettingsAtom, {
        ...store.get(mindroomSettingsAtom),
        prefetchScope: 'current-room-only',
      });
    });

    expect(readConfig?.()).toEqual({ scope: 'current-room-only' });
  });

  it('notifies the client engine when prefetch settings change', () => {
    const store = createStore();
    let subscribe: ReturnType<typeof usePrefetchConfigSubscription> | undefined;

    const Probe = () => {
      const nextSubscribe = usePrefetchConfigSubscription();
      useEffect(() => {
        subscribe = nextSubscribe;
      }, [nextSubscribe]);
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });

    let calls = 0;
    const unsubscribe = subscribe?.(() => {
      calls += 1;
    });
    act(() => {
      store.set(mindroomSettingsAtom, {
        ...store.get(mindroomSettingsAtom),
        prefetchScope: 'all-rooms',
      });
    });
    expect(calls).toBe(1);
    unsubscribe?.();
  });
});
