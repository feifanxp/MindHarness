import { createClient, MatrixError } from 'matrix-js-sdk';
import type { NavigateFunction } from 'react-router-dom';
import { getActiveSession, type StoredSession } from '../app/state/sessions';
import { requestAudienceOpenIdToken } from '../app/mindroom/matrix/openidAudience';
import { createStoredSessionTokenRefresh } from '../client/sessionTokenRefresh';
import { setAfterLoginRedirectPath } from '../app/pages/afterLoginRedirectPath';

export class DiscussionAuthError extends Error {}

const sessionPath = '/api/project-wizard/session';
const connecting = new Map<string, Promise<void>>();
const signingOut = new Set<string>();

const assertActive = (session: StoredSession) => {
  if (signingOut.has(session.sessionId) || getActiveSession()?.sessionId !== session.sessionId)
    throw new Error('账号已切换，请重新打开讨论。');
};

export const connectDiscussionSession = (session: StoredSession): Promise<void> => {
  if (signingOut.has(session.sessionId))
    return Promise.reject(new DiscussionAuthError('正在退出登录。'));
  const existing = connecting.get(session.sessionId);
  if (existing) return existing;
  const promise = (async () => {
    assertActive(session);
    const mx = createClient({
      baseUrl: session.baseUrl,
      userId: session.userId,
      accessToken: session.accessToken,
      deviceId: session.deviceId,
      refreshToken: session.refreshToken,
      tokenRefreshFunction: createStoredSessionTokenRefresh(session),
      localTimeoutMs: 15000,
    });
    const token = await requestAudienceOpenIdToken(mx, window.location.origin).catch((cause) => {
      if (cause instanceof MatrixError && cause.httpStatus === 401)
        throw new DiscussionAuthError('登录已过期，请重新登录。');
      throw cause;
    });
    assertActive(session);
    const response = await fetch(sessionPath, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-MindRoom-Discussion-User': session.userId },
      body: JSON.stringify({ openid_token: token }),
    });
    assertActive(session);
    if (!response.ok) {
      const error = await response.json();
      const ErrorType = response.status === 401 ? DiscussionAuthError : Error;
      throw new ErrorType(
        typeof error.detail === 'string' ? error.detail : '无法连接讨论账号，请重新登录。'
      );
    }
  })();
  connecting.set(session.sessionId, promise);
  void promise
    .finally(() => {
      if (connecting.get(session.sessionId) === promise) connecting.delete(session.sessionId);
    })
    .catch(() => {});
  return promise;
};

/** Finish any cookie-setting response before clearing the cookie, and prevent new exchanges. */
export async function disconnectDiscussionSession(session: StoredSession): Promise<void> {
  signingOut.add(session.sessionId);
  try {
    await connecting.get(session.sessionId)?.catch(() => {});
    const response = await fetch(sessionPath, {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('退出失败，请重试。');
  } catch (cause) {
    signingOut.delete(session.sessionId);
    throw cause;
  }
}

/** Capture the displayed identity across retries and refuse responses after an account switch. */
export async function discussionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getActiveSession();
  if (!session) throw new DiscussionAuthError('请先登录后继续讨论。');
  const headers = new Headers(init.headers);
  headers.set('X-MindRoom-Discussion-User', session.userId);
  const request = () =>
    fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  let response = await request();
  assertActive(session);
  if (response.status === 401 && !init.signal?.aborted) {
    await connectDiscussionSession(session);
    assertActive(session);
    init.signal?.throwIfAborted();
    response = await request();
    assertActive(session);
  }
  return response;
}

const pendingKey = 'mindroom.discussion.pending-input';
type PendingInput = { content: string; path: string; userId: string | null; savedAt: number };

export function beginDiscussionLogin({
  content = '',
  register = false,
  navigate,
  returnPath,
}: {
  content?: string;
  register?: boolean;
  navigate: NavigateFunction;
  returnPath: string;
}): void {
  const pending: PendingInput = {
    content,
    path: returnPath,
    userId: getActiveSession()?.userId ?? null,
    savedAt: Date.now(),
  };
  // Save the router-relative location: the browser pathname is not the route in hash mode.
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  setAfterLoginRedirectPath(returnPath);
  navigate((register ? '/register' : '/login') + '?addAccount=1');
}

export function readDiscussionInput(returnPath: string): string {
  try {
    const raw = sessionStorage.getItem(pendingKey);
    if (!raw) return '';
    const pending: PendingInput = JSON.parse(raw);
    const active = getActiveSession();
    if (
      !active ||
      typeof pending.content !== 'string' ||
      typeof pending.savedAt !== 'number' ||
      Date.now() - pending.savedAt > 15 * 60 * 1000 ||
      Date.now() < pending.savedAt ||
      pending.path !== returnPath ||
      (pending.userId !== null && pending.userId !== active.userId)
    )
      return '';
    return pending.content;
  } catch {
    return '';
  }
}

export function clearDiscussionInput(): void {
  sessionStorage.removeItem(pendingKey);
}
