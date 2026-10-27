/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import { App as CapacitorApp } from '@capacitor/app';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import 'katex/dist/katex.min.css';

enableMapSet();

import './index.css';

import { appUrl, ensureBasePathTrailingSlash, getAppBasePath } from './app/utils/basePath';
import {
  isNativeApp,
  isNativeIOS,
  registerNativeAppUrlCallbacks,
} from './app/mindroom/native/nativeSso';
import { isServiceWorkerEnabled } from './app/utils/runtimeConfig';
import { pushSessionToSW, waitForServiceWorkerControl } from './sw-session';
import { getActiveSession, subscribeToSessionStore } from './app/state/sessions';
import App from './app/pages/App';
import { applyThemeToDom, resolveInitialTheme } from './app/theme/themeBootstrap';
import { bootstrapRideTraceFlagFromUrl } from './app/mindroom/threads/rideTraceRecorder';
import { migrateMindroomSettingsStorage } from './app/mindroom/settings/mindroomSettingsStorage';
import { migrateLegacyIOSPushEnabled } from './app/mindroom/native/iosPush';
import { APP_BUILD_VERSION, fetchPublishedAppVersion, startAppVersionMonitor } from './appVersion';
import { createServiceWorkerUrl } from './serviceWorkerRegistration';
import { AUTHENTICATION_RECOVERY_NAVIGATION_PARAM } from './serviceWorkerNavigation';
import { installFlightRecorder } from './app/mindroom/diagnostics/flightRecorder';
import {
  initializeDeepTraceRecorder,
  recordDeepTraceEvent,
} from './app/mindroom/diagnostics/deepTrace';
import {
  installIndexedDbLossRecovery,
  readRecoveryReloadAge,
} from './app/mindroom/matrix/indexedDbLossRecovery';

// import i18n (needs to be bundled ;))
import './app/i18n';

applyThemeToDom(resolveInitialTheme());
// On-device scroll diagnostics: `?ridetrace=1` arms the timeline ride
// recorder (persisted; `?ridetrace=0` disarms). Read here because the
// router drops query params on navigation.
bootstrapRideTraceFlagFromUrl();

if (isNativeIOS()) {
  try {
    installFlightRecorder();
  } catch {
    // Diagnostics must never block application boot.
  }
  try {
    initializeDeepTraceRecorder();
  } catch {
    // Opt-in tracing must never block application boot.
  }
}

try {
  const reloadAge = readRecoveryReloadAge();
  if (reloadAge !== undefined) {
    recordDeepTraceEvent('storage.indexeddb_loss_reload', { reload_ms_ago: reloadAge });
  }
} catch {
  // Diagnostics must never block application boot.
}

try {
  installIndexedDbLossRecovery();
} catch {
  // Storage recovery must never block application boot.
}

if (isNativeApp()) {
  registerNativeAppUrlCallbacks(CapacitorApp);
}

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

let stopAppVersionMonitor: (() => void) | undefined;

const bootstrap = async () => {
  migrateLegacyIOSPushEnabled();
  migrateMindroomSettingsStorage();

  // Request persistent storage to prevent browser from evicting IndexedDB
  if (navigator.storage?.persist) {
    navigator.storage
      .persist()
      .then((granted) => {
        console.log(`[MindRoom Chat] Persistent storage: ${granted ? 'granted' : 'denied'}`);
      })
      .catch((err) => {
        console.warn('[MindRoom Chat] Persistent storage request failed:', err);
      });
  }

  mountApp();

  if ('serviceWorker' in navigator && isServiceWorkerEnabled()) {
    const postCurrentSessionToSW = () => {
      const session = getActiveSession();
      pushSessionToSW(session?.baseUrl, session?.accessToken);
    };
    subscribeToSessionStore(postCurrentSessionToSW);

    const isProductionSW = import.meta.env.MODE === 'production';
    const swUrl = isProductionSW
      ? createServiceWorkerUrl(APP_BUILD_VERSION)
      : appUrl('dev-sw.js?dev-sw');

    navigator.serviceWorker.ready.then(postCurrentSessionToSW).catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', postCurrentSessionToSW);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'requestSession') postCurrentSessionToSW();
    });
    try {
      await navigator.serviceWorker.register(swUrl, {
        scope: ensureBasePathTrailingSlash(getAppBasePath()),
        // vite-plugin-pwa's devOptions serve dev-sw.js as an ES module
        // (type: 'module' in vite.config.js); registering it as a classic
        // script throws "Cannot use import statement outside a module" and
        // dev runs silently without a service worker. The production sw.js
        // is bundled as a classic script.
        type: isProductionSW ? 'classic' : 'module',
        updateViaCache: 'none',
      });
      if (isProductionSW) {
        stopAppVersionMonitor?.();
        stopAppVersionMonitor = startAppVersionMonitor();
      }
    } catch {
      // Keep booting even if service worker registration fails.
    }

    // A force-reload loads the page uncontrolled for its entire lifetime
    // (re-registering an unchanged worker never fires controllerchange),
    // which would leave authenticated media broken all session. One
    // guarded reload restores control; the flag prevents a reload loop
    // when no worker can take over. The flag is cleared on EVERY
    // controlled boot — the reloaded page boots controlled and skips the
    // guard below, so clearing only inside it would arm the guard once
    // per tab lifetime.
    const RELOAD_FLAG = 'mindroom_sw_control_reloaded';
    try {
      if (navigator.serviceWorker.controller) {
        window.sessionStorage.removeItem(RELOAD_FLAG);
      } else if (getActiveSession()) {
        const controlled = await waitForServiceWorkerControl();
        if (controlled) {
          window.sessionStorage.removeItem(RELOAD_FLAG);
        } else {
          const registration = await navigator.serviceWorker
            .getRegistration()
            .catch(() => undefined);
          if (registration?.active && !window.sessionStorage.getItem(RELOAD_FLAG)) {
            const publishedVersion = navigator.onLine
              ? await fetchPublishedAppVersion()
              : undefined;
            if (publishedVersion) {
              // An older active worker may still serve its cached shell while
              // the newly registered worker waits for other tabs to close.
              // Restore control through the network so this reload keeps the
              // version the hard refresh just loaded.
              const reloadUrl = new URL(window.location.href);
              reloadUrl.searchParams.set(AUTHENTICATION_RECOVERY_NAVIGATION_PARAM, '1');
              window.history.replaceState(window.history.state, '', reloadUrl.href);
              window.sessionStorage.setItem(RELOAD_FLAG, '1');
              window.location.reload();
              return;
            }
          }
        }
      }
    } catch {
      // Blocked sessionStorage degrades to the pre-fix behavior.
    }

    postCurrentSessionToSW();
  }
};

bootstrap().catch(() => undefined);
