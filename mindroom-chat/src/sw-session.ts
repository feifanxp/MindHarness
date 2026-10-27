/**
 * Wait for a service worker to take control of the page.
 * Resolves true immediately if already controlled.
 * Resolves true on 'controllerchange' event.
 * Resolves false after timeout (default 3000ms).
 */
export function waitForServiceWorkerControl(timeoutMs = 3000): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);
  const { serviceWorker } = navigator;

  if (serviceWorker.controller) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    let finish: (controlled: boolean) => void = () => undefined;

    const handleControllerChange = () => {
      finish(true);
    };

    finish = (controlled: boolean) => {
      if (settled) return;
      settled = true;

      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }

      serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(controlled);
    };

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);

    serviceWorker.addEventListener('controllerchange', handleControllerChange);

    if (serviceWorker.controller) {
      finish(true);
    }
  });
}

export function pushSessionToSW(baseUrl?: string, accessToken?: string) {
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage({
    type: 'setSession',
    accessToken,
    baseUrl,
  });
}
