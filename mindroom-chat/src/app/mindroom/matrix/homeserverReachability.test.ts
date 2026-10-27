// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHomeserverReachability,
  HOMESERVER_CHECK_TIMEOUT_MS,
  HOMESERVER_RECHECK_INTERVAL_MS,
} from './homeserverReachability';

const BASE_URL = 'https://matrix.example';
const SEND_URL = `${BASE_URL}/_matrix/client/v3/rooms/!a/send/m.room.message/1`;
const SYNC_URL = `${BASE_URL}/_matrix/client/v3/sync`;
const VERSIONS_URL = `${BASE_URL}/_matrix/client/versions`;

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

const networkError = () => new TypeError('Load failed');

// What the browser dispatches when a reload or navigation starts.
const leavePage = () => window.dispatchEvent(new Event('beforeunload'));

const pending = () => {
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((_, onReject) => {
    reject = onReject;
  });
  return { promise, reject };
};

const track = (baseFetch: ReturnType<typeof vi.fn>, { shown = true } = {}) => {
  const reachability = createHomeserverReachability(baseFetch as unknown as typeof fetch, BASE_URL);
  const listener = vi.fn();
  const unsubscribe = shown ? reachability.subscribe(listener) : () => undefined;
  const request = (url = SEND_URL, init?: RequestInit) =>
    reachability.fetchFn(url, init).catch(() => undefined);
  return { reachability, listener, request, unsubscribe };
};

const checkCalls = (baseFetch: ReturnType<typeof vi.fn>) =>
  baseFetch.mock.calls.filter(([url]) => url === VERSIONS_URL);

describe('homeserver reachability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('reports the homeserver unreachable when a check after a failed request fails too', async () => {
    const baseFetch = vi.fn().mockRejectedValue(networkError());
    const { reachability, listener, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(0);

    expect(baseFetch).toHaveBeenLastCalledWith(
      VERSIONS_URL,
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(reachability.isUnreachable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports the homeserver unreachable when the check gets no answer in time', async () => {
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            );
          })
      );
    const { reachability, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS - 1);
    expect(reachability.isUnreachable()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(reachability.isUnreachable()).toBe(true);
  });

  it('does not report a failed request when the homeserver answers the check', async () => {
    const { reachability, listener, request } = track(
      vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(new Response('{}'))
    );

    await request();
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(reachability.isUnreachable()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not report a failed check when another request was answered meanwhile', async () => {
    const check = pending();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockReturnValueOnce(check.promise)
      .mockResolvedValueOnce(new Response('{}'));
    const { reachability, request } = track(baseFetch);

    await request();
    await request(SYNC_URL);
    check.reject(networkError());
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(reachability.isUnreachable()).toBe(false);
  });

  it('reports the homeserver reachable again on any HTTP response, error statuses included', async () => {
    const { reachability, request } = track(
      vi
        .fn()
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockResolvedValueOnce(new Response(null, { status: 502 }))
    );

    await request();
    await vi.advanceTimersByTimeAsync(0);
    expect(reachability.isUnreachable()).toBe(true);

    const response = await reachability.fetchFn(SYNC_URL);

    expect(response.status).toBe(502);
    expect(reachability.isUnreachable()).toBe(false);
  });

  it('ignores aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'))
      .mockRejectedValueOnce(networkError());
    const { reachability, request } = track(baseFetch);

    await request();
    await request(SEND_URL, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(checkCalls(baseFetch)).toHaveLength(0);
    expect(reachability.isUnreachable()).toBe(false);
  });

  it('ignores requests that were in flight while the page was hidden', async () => {
    const suspended = pending();
    const baseFetch = vi.fn().mockReturnValueOnce(suspended.promise);
    const { reachability, request } = track(baseFetch);

    const suspendedRequest = request();
    setVisibility('hidden');
    setVisibility('visible');
    suspended.reject(networkError());
    await suspendedRequest;
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(checkCalls(baseFetch)).toHaveLength(0);
    expect(reachability.isUnreachable()).toBe(false);
  });

  it('ignores requests that fail while the page is hidden', async () => {
    setVisibility('hidden');
    const baseFetch = vi.fn().mockRejectedValue(networkError());
    const { reachability, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(checkCalls(baseFetch)).toHaveLength(0);
    expect(reachability.isUnreachable()).toBe(false);
  });

  it('ignores requests cut off by leaving the page', async () => {
    const cutOff = pending();
    const baseFetch = vi.fn().mockReturnValueOnce(cutOff.promise);
    const { reachability, listener, request } = track(baseFetch);

    const cutOffRequest = request(SYNC_URL);
    leavePage();
    cutOff.reject(networkError());
    await cutOffRequest;
    await vi.advanceTimersByTimeAsync(HOMESERVER_CHECK_TIMEOUT_MS);

    expect(checkCalls(baseFetch)).toHaveLength(0);
    expect(reachability.isUnreachable()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not check again when a check is cut off by leaving the page', async () => {
    const cutOffCheck = pending();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockReturnValueOnce(cutOffCheck.promise)
      .mockRejectedValue(networkError());
    const { reachability, listener, request } = track(baseFetch);

    await request();
    leavePage();
    cutOffCheck.reject(networkError());
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);

    expect(checkCalls(baseFetch)).toHaveLength(1);
    expect(reachability.isUnreachable()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('counts failed requests again when the page stays after it started to leave', async () => {
    // For example a cancelled navigation or a download link.
    leavePage();
    const baseFetch = vi.fn().mockRejectedValue(networkError());
    const { reachability, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(0);

    expect(checkCalls(baseFetch)).toHaveLength(1);
    expect(reachability.isUnreachable()).toBe(true);
  });

  it('ignores a check suspended with the page and checks again once the page is shown', async () => {
    const suspendedCheck = pending();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockReturnValueOnce(suspendedCheck.promise)
      .mockRejectedValue(networkError());
    const { reachability, listener, request } = track(baseFetch);

    await request();
    setVisibility('hidden');
    suspendedCheck.reject(networkError());
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);
    expect(checkCalls(baseFetch)).toHaveLength(1);
    expect(reachability.isUnreachable()).toBe(false);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);

    expect(checkCalls(baseFetch)).toHaveLength(2);
    expect(reachability.isUnreachable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not report an outage after the page is shown when the homeserver answers then', async () => {
    const suspendedCheck = pending();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockReturnValueOnce(suspendedCheck.promise)
      .mockResolvedValue(new Response('{}'));
    const { reachability, listener, request } = track(baseFetch);

    await request();
    setVisibility('hidden');
    suspendedCheck.reject(networkError());
    await vi.advanceTimersByTimeAsync(0);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);

    expect(checkCalls(baseFetch)).toHaveLength(2);
    expect(reachability.isUnreachable()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('checks again right away when a suspended check ends after the page is shown', async () => {
    const suspendedCheck = pending();
    const freshCheck = pending();
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockReturnValueOnce(suspendedCheck.promise)
      .mockReturnValueOnce(freshCheck.promise);
    const { reachability, request } = track(baseFetch);

    await request();
    setVisibility('hidden');
    setVisibility('visible');
    suspendedCheck.reject(networkError());
    await vi.advanceTimersByTimeAsync(0);
    expect(checkCalls(baseFetch)).toHaveLength(2);
    expect(reachability.isUnreachable()).toBe(false);

    freshCheck.reject(networkError());
    await vi.advanceTimersByTimeAsync(0);
    expect(reachability.isUnreachable()).toBe(true);
  });

  it('checks the homeserver again while it is shown as unreachable, until it answers', async () => {
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response('{}'));
    const { reachability, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS);
    expect(checkCalls(baseFetch)).toHaveLength(2);
    expect(reachability.isUnreachable()).toBe(true);

    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS);
    expect(checkCalls(baseFetch)).toHaveLength(3);
    expect(reachability.isUnreachable()).toBe(false);

    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);
    expect(baseFetch).toHaveBeenCalledTimes(4);
  });

  it('checks the homeserver again only while the connection status is shown, and right away once it is', async () => {
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response('{}'));
    const { reachability, request } = track(baseFetch, { shown: false });

    await request();
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);
    expect(checkCalls(baseFetch)).toHaveLength(1);
    expect(reachability.isUnreachable()).toBe(true);

    const unsubscribe = reachability.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(checkCalls(baseFetch)).toHaveLength(2);
    expect(reachability.isUnreachable()).toBe(false);
    unsubscribe();
  });

  it('stops checking again once another request reaches the homeserver', async () => {
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response('{}'));
    const { reachability, request } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(0);
    expect(reachability.isUnreachable()).toBe(true);
    await request(SYNC_URL);
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 2);

    expect(checkCalls(baseFetch)).toHaveLength(1);
    expect(reachability.isUnreachable()).toBe(false);
  });

  it('stops checking again once nothing shows the connection status', async () => {
    const baseFetch = vi.fn().mockRejectedValue(networkError());
    const { reachability, request, unsubscribe } = track(baseFetch);

    await request();
    await vi.advanceTimersByTimeAsync(0);
    expect(reachability.isUnreachable()).toBe(true);
    const unsubscribeSecond = reachability.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(checkCalls(baseFetch)).toHaveLength(2);

    unsubscribeSecond();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(HOMESERVER_RECHECK_INTERVAL_MS * 3);

    expect(checkCalls(baseFetch)).toHaveLength(2);
  });
});
