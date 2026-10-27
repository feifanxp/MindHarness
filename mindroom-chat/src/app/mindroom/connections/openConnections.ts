import type { IOpenIDToken } from 'matrix-js-sdk';

const PORTAL_PATH = '/connections/';
const PORTAL_WINDOW_NAME = 'mindroom-connections';
const READY_MESSAGE_TYPE = 'mindroom:connections-ready';
const OPENID_MESSAGE_TYPE = 'mindroom:connections-openid';
const DEFAULT_POLL_MS = 1000;

export type OpenConnectionsPortalOptions = {
  backendUrl: string;
  /** Requests a token bound to `audience`, the backend origin the portal window is answered at. */
  getOpenIdToken: (audience: string) => Promise<IOpenIDToken>;
  win?: Window;
  pollMs?: number;
};

const isReadyMessage = (data: unknown): boolean =>
  typeof data === 'object' &&
  data !== null &&
  (data as { type?: unknown }).type === READY_MESSAGE_TYPE;

// A second click reuses the named window, so only one session may answer its ready messages.
let stopPreviousSession: (() => void) | undefined;

/**
 * Opens the backend Connections portal and answers its ready message with a Matrix OpenID token.
 * Call it synchronously from a click handler so popup blockers allow the window.
 * The token is requested per ready message, so a portal reload after session expiry gets a fresh one.
 */
export function openConnectionsPortal({
  backendUrl,
  getOpenIdToken,
  win = window,
  pollMs = DEFAULT_POLL_MS,
}: OpenConnectionsPortalOptions): 'opened' | 'blocked' {
  const backendOrigin = new URL(backendUrl).origin;
  const portalUrl = new URL(PORTAL_PATH, backendUrl).toString();

  // No `noopener`: the portal needs `window.opener` to ask for the token.
  const target = win.open(portalUrl, PORTAL_WINDOW_NAME);
  if (!target) return 'blocked';

  stopPreviousSession?.();

  let stopped = false;
  const reply = async (): Promise<void> => {
    const openidToken = await getOpenIdToken(backendOrigin);
    // A token requested before the session ended must not reach a window another account may now own.
    if (stopped) return;
    // The backend origin as target origin makes the browser drop the token if the window navigated elsewhere.
    target.postMessage({ type: OPENID_MESSAGE_TYPE, openid_token: openidToken }, backendOrigin);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target || event.origin !== backendOrigin) return;
    if (!isReadyMessage(event.data)) return;
    // A failed token request sends nothing; the portal shows its own sign-in message.
    reply().catch(() => undefined);
  };

  let interval: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    stopped = true;
    win.removeEventListener('message', onMessage);
    clearInterval(interval);
    if (stopPreviousSession === stop) stopPreviousSession = undefined;
  };

  win.addEventListener('message', onMessage);
  interval = setInterval(() => {
    if (target.closed) stop();
  }, pollMs);
  stopPreviousSession = stop;

  return 'opened';
}
