import { useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/**
 * How long a check of the homeserver may wait for an answer. Unanswered checks
 * only happen on stalled connections; failing ones end right away.
 */
export const HOMESERVER_CHECK_TIMEOUT_MS = 8_000;
/** Delay between checks while the homeserver is shown as unreachable. */
export const HOMESERVER_RECHECK_INTERVAL_MS = 5_000;

export type HomeserverReachability = {
  fetchFn: typeof globalThis.fetch;
  isUnreachable: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

const reachabilityByClient = new WeakMap<MatrixClient, HomeserverReachability>();

// WebKit fails requests that were in flight while the app was suspended, so a
// failure only counts when the page stayed visible for the whole request.
// WebKit also fails in-flight requests as soon as the page starts to unload
// (reload or navigation), before `pagehide`, and refuses new ones until the
// next page loads, so a failure only counts when the page did not start to
// leave during the request either.
let visibilityChanges = 0;
let pageLeaves = 0;
let watchingPage = false;
const checksOwedOnShow = new Set<() => void>();

type PageState = { visibilityChanges: number; pageLeaves: number };

const pageState = (): PageState => ({ visibilityChanges, pageLeaves });

const isPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

const watchPage = (): void => {
  if (watchingPage || typeof document === 'undefined') return;
  watchingPage = true;
  document.addEventListener('visibilitychange', () => {
    visibilityChanges += 1;
    const checks = [...checksOwedOnShow];
    checksOwedOnShow.clear();
    checks.forEach((check) => check());
  });
  // Only counts; it never asks the user to stay.
  window.addEventListener('beforeunload', () => {
    pageLeaves += 1;
  });
};

const startedLeaving = (atStart: PageState): boolean => pageLeaves !== atStart.pageLeaves;

const stayedVisible = (atStart: PageState): boolean =>
  !startedLeaving(atStart) && visibilityChanges === atStart.visibilityChanges && !isPageHidden();

const isAbort = (error: unknown, init?: RequestInit): boolean =>
  init?.signal?.aborted === true || (error as Error | undefined)?.name === 'AbortError';

/**
 * Tracks whether the homeserver answers the requests made with `baseFetch`.
 *
 * matrix-js-sdk reports a lost connection only when the sync loop's own
 * requests fail. A send that cannot reach the server while those are pending,
 * for example before the first /sync, leaves the sync state unchanged. Here a
 * request that fails at the network level starts a check of the homeserver,
 * which makes it unreachable when nothing answers while the check runs. Any
 * HTTP response, error statuses included, makes it reachable again. While the
 * connection status is shown, the check repeats, so the status also clears
 * when nothing else is sent.
 */
export const createHomeserverReachability = (
  baseFetch: typeof globalThis.fetch,
  baseUrl: string
): HomeserverReachability => {
  watchPage();
  const versionsUrl = `${baseUrl.replace(/\/+$/, '')}/_matrix/client/versions`;
  const listeners = new Set<() => void>();
  let unreachable = false;
  let responses = 0;
  let checking = false;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;

  const setUnreachable = (next: boolean) => {
    if (unreachable === next) return;
    unreachable = next;
    listeners.forEach((listener) => listener());
  };

  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const pageAtStart = pageState();
    try {
      const response = await baseFetch(input, init);
      responses += 1;
      setUnreachable(false);
      return response;
    } catch (error) {
      if (!unreachable && !isAbort(error, init) && stayedVisible(pageAtStart)) {
        check();
      }
      throw error;
    }
  };

  function scheduleRecheck() {
    if (!unreachable || listeners.size === 0 || recheckTimer !== undefined) return;
    recheckTimer = setTimeout(() => {
      recheckTimer = undefined;
      if (unreachable) check();
    }, HOMESERVER_RECHECK_INTERVAL_MS);
  }

  function check() {
    if (checking) return;
    checking = true;
    const responsesAtStart = responses;
    const pageAtStart = pageState();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOMESERVER_CHECK_TIMEOUT_MS);
    // Bypass the HTTP cache so only the homeserver itself can answer.
    fetchFn(versionsUrl, { cache: 'no-store', signal: controller.signal })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        checking = false;
        if (responses === responsesAtStart) {
          if (stayedVisible(pageAtStart)) setUnreachable(true);
          // A check suspended with the page says nothing, so check again once
          // the page is shown.
          else if (isPageHidden()) checksOwedOnShow.add(check);
          // A check cut off by leaving the page says nothing either, and a new
          // one would be refused while the page unloads.
          else if (!startedLeaving(pageAtStart)) check();
        }
        scheduleRecheck();
      });
  }

  return {
    fetchFn,
    isUnreachable: () => unreachable,
    subscribe: (listener) => {
      listeners.add(listener);
      if (unreachable) check();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && recheckTimer !== undefined) {
          clearTimeout(recheckTimer);
          recheckTimer = undefined;
        }
      };
    },
  };
};

export const bindHomeserverReachability = (
  mx: MatrixClient,
  reachability: HomeserverReachability
): void => {
  reachabilityByClient.set(mx, reachability);
};

const subscribeNever = () => () => undefined;
const alwaysReachable = () => false;

export const useHomeserverUnreachable = (mx: MatrixClient): boolean => {
  const reachability = reachabilityByClient.get(mx);
  return useSyncExternalStore(
    reachability?.subscribe ?? subscribeNever,
    reachability?.isUnreachable ?? alwaysReachable
  );
};
