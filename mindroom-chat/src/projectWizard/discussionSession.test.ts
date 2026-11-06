// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getActiveSession, putSession } from '../app/state/sessions';
import { requestAudienceOpenIdToken } from '../app/mindroom/matrix/openidAudience';
import {
  beginDiscussionLogin,
  clearDiscussionInput,
  connectDiscussionSession,
  disconnectDiscussionSession,
  discussionFetch,
  readDiscussionInput,
} from './discussionSession';

vi.mock('../app/mindroom/matrix/openidAudience', () => ({ requestAudienceOpenIdToken: vi.fn() }));
const alice = {
  baseUrl: 'https://matrix.example',
  userId: '@alice:example',
  accessToken: 'a',
  deviceId: 'A',
};
const bob = { ...alice, userId: '@bob:example', accessToken: 'b', deviceId: 'B' };
const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/discussion');
  putSession(alice);
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(requestAudienceOpenIdToken).mockResolvedValue({
    access_token: 'proof',
    token_type: 'Bearer',
    matrix_server_name: 'example',
    expires_in: 300,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('exchanges a verified identity and retries an expired discussion session once', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(response(401))
    .mockResolvedValueOnce(response(200))
    .mockResolvedValueOnce(response(200, []));
  const result = await discussionFetch('/api/project-wizard/drafts');
  expect(result.status).toBe(200);
  expect(requestAudienceOpenIdToken).toHaveBeenCalledWith(
    expect.anything(),
    window.location.origin
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  const calls = vi.mocked(fetch).mock.calls;
  expect(new Headers(calls[0][1]?.headers).get('X-MindRoom-Discussion-User')).toBe(alice.userId);
  expect(calls[1][0]).toBe('/api/project-wizard/session');
  expect(JSON.parse(calls[1][1]?.body as string)).toHaveProperty(
    'openid_token.access_token',
    'proof'
  );
});

it('rejects an old account response after the active account changes', async () => {
  let finish!: (result: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const result = discussionFetch('/api/project-wizard/drafts');
  putSession(bob);
  finish(response(200, [{ name: 'Alice private draft' }]));
  await expect(result).rejects.toThrow('账号已切换');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('never exchanges an old proof after account switching', async () => {
  let finish!: (token: Awaited<ReturnType<typeof requestAudienceOpenIdToken>>) => void;
  vi.mocked(requestAudienceOpenIdToken).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const result = connectDiscussionSession(getActiveSession()!);
  putSession(bob);
  finish({
    access_token: 'old-proof',
    token_type: 'Bearer',
    matrix_server_name: 'example',
    expires_in: 300,
  });
  await expect(result).rejects.toThrow('账号已切换');
  expect(fetch).not.toHaveBeenCalled();
});

it('does not silently retry a forbidden operation', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response(403));
  expect((await discussionFetch('/api/project-wizard/drafts')).status).toBe(403);
  expect(requestAudienceOpenIdToken).not.toHaveBeenCalled();
});

it('shares concurrent exchanges for the same account', async () => {
  vi.mocked(fetch).mockResolvedValue(response(200));
  await Promise.all([
    connectDiscussionSession(getActiveSession()!),
    connectDiscussionSession(getActiveSession()!),
  ]);
  expect(requestAudienceOpenIdToken).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps pending input through repeated StrictMode initializer reads', () => {
  sessionStorage.setItem(
    'mindroom.discussion.pending-input',
    JSON.stringify({
      content: '想聊一个产品',
      path: '/discussion',
      userId: null,
      savedAt: Date.now(),
    })
  );
  expect(readDiscussionInput('/discussion')).toBe('想聊一个产品');
  expect(readDiscussionInput('/discussion')).toBe('想聊一个产品');
  clearDiscussionInput();
  expect(readDiscussionInput('/discussion')).toBe('');
});

it('does not restore another accounts private input or expired input', () => {
  sessionStorage.setItem(
    'mindroom.discussion.pending-input',
    JSON.stringify({
      content: 'private',
      path: '/discussion',
      userId: bob.userId,
      savedAt: Date.now(),
    })
  );
  expect(readDiscussionInput('/discussion')).toBe('');
  sessionStorage.setItem(
    'mindroom.discussion.pending-input',
    JSON.stringify({
      content: 'old',
      path: '/discussion',
      userId: alice.userId,
      savedAt: Date.now() - 16 * 60 * 1000,
    })
  );
  expect(readDiscussionInput('/discussion')).toBe('');
});

it.each([false, true])(
  'uses the router for auth navigation in hash mode (register=%s)',
  (register) => {
    window.history.replaceState(null, '', '/chat.html#/discussion/draft-1?tab=notes');
    const navigate = vi.fn();
    beginDiscussionLogin({
      content: '保留输入',
      register,
      navigate,
      returnPath: '/discussion/draft-1?tab=notes',
    });
    expect(navigate).toHaveBeenCalledWith((register ? '/register' : '/login') + '?addAccount=1');
    expect(window.location.hash).toBe('#/discussion/draft-1?tab=notes');
    expect(readDiscussionInput('/discussion/draft-1?tab=notes')).toBe('保留输入');
    expect(readDiscussionInput('/chat.html')).toBe('');
  }
);

it('clears the cookie only after an in-flight sign-in finishes and prevents another exchange', async () => {
  putSession({ ...alice, userId: '@logout-race:example', deviceId: 'LOGOUT' });
  const session = getActiveSession()!;
  let finish!: (response: Response) => void;
  vi.mocked(fetch)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce(response(200));
  const login = connectDiscussionSession(session);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const logout = disconnectDiscussionSession(session);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(200));
  await expect(login).rejects.toThrow('账号已切换');
  await logout;
  expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe('DELETE');
  await expect(connectDiscussionSession(session)).rejects.toThrow('正在退出');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('allows reconnection when cookie logout fails', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200));
  await expect(disconnectDiscussionSession(getActiveSession()!)).rejects.toThrow('退出失败');
  await connectDiscussionSession(getActiveSession()!);
  expect(requestAudienceOpenIdToken).toHaveBeenCalledTimes(1);
});

it('retains an old account exchange while another account signs in before logout', async () => {
  const first = { ...alice, userId: '@switch-logout-a:example', deviceId: 'SA' };
  const second = { ...bob, userId: '@switch-logout-b:example', deviceId: 'SB' };
  let finishA!: (result: Response) => void;
  let finishB!: (result: Response) => void;
  vi.mocked(fetch)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishA = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishB = resolve;
      })
    )
    .mockResolvedValueOnce(response(200));
  putSession(first);
  const sessionA = getActiveSession()!;
  const loginA = connectDiscussionSession(sessionA);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  putSession(second);
  const loginB = connectDiscussionSession(getActiveSession()!);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  putSession(first);
  const logout = disconnectDiscussionSession(sessionA);
  expect(fetch).toHaveBeenCalledTimes(2);
  finishA(response(200));
  await expect(loginA).rejects.toThrow('账号已切换');
  await logout;
  expect(vi.mocked(fetch).mock.calls[2][1]?.method).toBe('DELETE');
  finishB(response(200));
  await expect(loginB).rejects.toThrow('账号已切换');
});
