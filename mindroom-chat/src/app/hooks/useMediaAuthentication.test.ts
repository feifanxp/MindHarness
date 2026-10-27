import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasMediaAuthTransportSupport,
  shouldUseMediaAuthentication,
  useMediaAuthentication,
} from './useMediaAuthentication';

vi.mock('./useSpecVersions', () => ({
  useSpecVersions: () => ({ versions: ['v1.11'] }),
}));

vi.mock('../utils/runtimeConfig', () => ({
  isServiceWorkerEnabled: () => true,
}));

type MockServiceWorkerContainer = EventTarget & { controller: object | null };

const originalNavigator = globalThis.navigator;
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
  vi.restoreAllMocks();
});

describe('shouldUseMediaAuthentication', () => {
  it('returns false when spec supports authenticated media but service worker is disabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        false
      )
    ).toBe(false);
  });

  it('returns true when spec supports authenticated media and service worker is enabled', () => {
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });

  it('returns true when service worker is unavailable but Capacitor transport fallback is available', () => {
    expect(hasMediaAuthTransportSupport(false, true)).toBe(true);
    expect(
      shouldUseMediaAuthentication(
        {
          versions: ['v1.11'],
        },
        true
      )
    ).toBe(true);
  });

  it('reactively enables authenticated media after service worker takeover', () => {
    const serviceWorker = new EventTarget() as MockServiceWorkerContainer;
    serviceWorker.controller = null;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serviceWorker },
    });
    let mediaAuthentication = true;
    const Probe = () => {
      mediaAuthentication = useMediaAuthentication();
      return null;
    };

    act(() => {
      renderer = create(React.createElement(Probe));
    });
    expect(mediaAuthentication).toBe(false);

    act(() => {
      serviceWorker.controller = {};
      serviceWorker.dispatchEvent(new Event('controllerchange'));
    });
    expect(mediaAuthentication).toBe(true);
  });
});
