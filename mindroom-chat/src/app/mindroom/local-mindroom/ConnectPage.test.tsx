// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPage } from './ConnectPage';
import {
  approveLocalMindroomPairCode,
  inspectLocalMindroomPairCode,
  LocalMindroomApiError,
  requestMatrixOpenIdToken,
  type LocalMindroomPairDevice,
} from './api';
import { useClientConfig } from '../../hooks/useClientConfig';
import { createMatrixClient } from '../matrix/matrixClientFactory';
import { getAfterLoginRedirectPath } from '../../pages/afterLoginRedirectPath';
import { getActiveSession, getSessionStore, putSession, removeSession } from '../../state/sessions';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const element =
    (tag: string) =>
    ({ children, before, after, as, ...props }: Props) =>
      reactModule.createElement(
        (as as string | undefined) ?? tag,
        props,
        before as React.ReactNode,
        children,
        after as React.ReactNode
      );

  return {
    Box: element('div'),
    Button: element('button'),
    Header: element('header'),
    Input: (props: Props) => reactModule.createElement('input', props),
    Scroll: element('div'),
    Spinner: () => null,
    Text: element('span'),
    color: {
      Critical: { Main: 'critical' },
      Success: { Main: 'success' },
      Warning: { Main: 'warning' },
    },
  };
});

vi.mock('../../pages/auth/styles.css', () => ({
  AuthCard: 'auth-card',
  AuthCardContent: 'auth-card-content',
  AuthHeader: 'auth-header',
  AuthLayout: 'auth-layout',
  AuthLayoutPersistentParticle: 'auth-layout-persistent-particle',
  AuthLogo: 'auth-logo',
}));

vi.mock('../../components/particle-background', () => ({
  ParticleBackgroundSurface: () => null,
  usePersistentParticleBackground: () => false,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(),
}));

vi.mock('../matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  approveLocalMindroomPairCode: vi.fn(),
  inspectLocalMindroomPairCode: vi.fn(),
  requestMatrixOpenIdToken: vi.fn(),
}));

const inspectMock = vi.mocked(inspectLocalMindroomPairCode);
const approveMock = vi.mocked(approveLocalMindroomPairCode);
const openIdMock = vi.mocked(requestMatrixOpenIdToken);

const pendingDevice = (): LocalMindroomPairDevice => ({
  client_name: 'studio-mac',
  client_ip: '203.0.113.7',
  created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  expires_at: new Date(Date.now() + 8 * 60_000).toISOString(),
  status: 'pending',
});

const storeSession = (userId: string, baseUrl: string, refreshToken?: string) =>
  putSession({
    baseUrl,
    userId,
    deviceId: 'DEVICE',
    accessToken: `${userId}-access`,
    refreshToken,
  });

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

let renderer: ReactTestRenderer | undefined;
let navigate: ReturnType<typeof useNavigate>;

function NavigationProbe() {
  navigate = useNavigate();
  return null;
}

const renderAt = async (entry: string) => {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[entry]}>
        <NavigationProbe />
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const textOf = (node: ReactTestInstance | undefined = renderer?.root): string =>
  (node?.children ?? [])
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');

const findButton = (label: string): ReactTestInstance => {
  const button = renderer?.root
    .findAllByType('button')
    .find((candidate) => textOf(candidate).includes(label));
  if (!button) throw new Error(`Missing button: ${label}\n${textOf()}`);
  return button;
};

const click = async (label: string) => {
  await act(async () => {
    findButton(label).props.onClick();
  });
  await flush();
};

beforeEach(() => {
  vi.mocked(useClientConfig).mockReturnValue({
    sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' },
  });
  openIdMock.mockImplementation(async ({ accessToken }) => `openid:${accessToken}`);
  inspectMock.mockImplementation(async () => pendingDevice());
  approveMock.mockImplementation(async () => ({ ...pendingDevice(), status: 'approved' }));
});

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ConnectPage', () => {
  it('inspects the code and approves it with the only eligible account', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');

    await renderAt('/connect?code=abcd-efgh');

    expect(inspectMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(textOf()).toContain('studio-mac');
    expect(textOf()).toContain('Started 2 minutes ago');
    expect(textOf()).toContain('Requested from 203.0.113.7');
    expect(textOf()).toContain(
      'Only approve if you just started this on your own machine and your terminal shows the same code.'
    );

    await click('Approve as @alice:mindroom.chat');

    expect(approveMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(textOf()).toContain('Connected. You can return to your terminal.');
    expect(() => findButton('Approve as')).toThrow();
  });

  it('shows an unknown address when the service omits it', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const { client_ip: _clientIp, ...olderServiceDevice } = pendingDevice();
    inspectMock.mockResolvedValueOnce(olderServiceDevice);

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('studio-mac');
    expect(textOf()).toContain('Requested from an unknown address');
    expect(findButton('Approve as @alice:mindroom.chat').props.disabled).toBe(false);
  });

  it('approves with a chosen non-active account without switching the active account', async () => {
    const first = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:mindroom.chat', 'https://mindroom.chat');
    const active = storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).not.toContain('@carol:matrix.org');
    await click('@alice:mindroom.chat');

    expect(inspectMock).toHaveBeenLastCalledWith(
      'ABCD-EFGH',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );

    await click('Approve as @alice:mindroom.chat');

    expect(approveMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(getActiveSession()?.sessionId).toBe(active.sessionId);
    expect(getActiveSession()?.sessionId).not.toBe(first.sessionId);
  });

  it('locks the account choice while approving and drops a result for an account no longer chosen', async () => {
    const alice = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:mindroom.chat', 'https://mindroom.chat');
    let finishApprove: (device: LocalMindroomPairDevice) => void = () => undefined;
    approveMock.mockImplementation(
      () =>
        new Promise<LocalMindroomPairDevice>((resolve) => {
          finishApprove = resolve;
        })
    );

    await renderAt('/connect?code=ABCD-EFGH');
    await click('@alice:mindroom.chat');
    await click('Approve as @alice:mindroom.chat');

    expect(findButton('@bob:mindroom.chat').props.disabled).toBe(true);

    await act(async () => {
      removeSession(alice.sessionId);
    });
    await flush();
    await act(async () => {
      finishApprove({ ...pendingDevice(), status: 'approved' });
    });
    await flush();

    expect(textOf()).not.toContain('Connected. You can return to your terminal.');
    expect(findButton('Approve as @bob:mindroom.chat').props.disabled).toBe(false);
  });

  it.each(['success', 'failure'])(
    'drops an old approval %s after opening another pairing link',
    async (outcome) => {
      storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
      let finishApprove!: (device: LocalMindroomPairDevice) => void;
      let failApprove!: (error: Error) => void;
      approveMock.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishApprove = resolve;
            failApprove = reject;
          })
      );

      await renderAt('/connect?code=ABCD-EFGH');
      await click('Approve as @alice:mindroom.chat');
      inspectMock.mockResolvedValueOnce({ ...pendingDevice(), client_name: 'second-mac' });
      await act(async () => navigate('/connect?code=JKLM-NPQR'));
      await flush();
      expect(textOf()).toContain('second-mac');

      await act(async () => {
        if (outcome === 'success') finishApprove({ ...pendingDevice(), status: 'approved' });
        else failApprove(new Error('Old approval failed'));
      });
      await flush();

      expect(textOf()).toContain('second-mac');
      expect(textOf()).not.toContain('Connected. You can return to your terminal.');
      expect(textOf()).not.toContain('Old approval failed');
      expect(findButton('Approve as @alice:mindroom.chat').props.disabled).toBe(false);
      expect(approveMock).toHaveBeenCalledTimes(1);
    }
  );

  it('refreshes an expired stored token, saves it, and retries once', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', 'refresh-a');
    const refreshToken = vi
      .fn()
      .mockResolvedValue({ access_token: 'access-b', refresh_token: 'refresh-b' });
    vi.mocked(createMatrixClient).mockReturnValue({ refreshToken } as never);
    openIdMock.mockRejectedValueOnce(new LocalMindroomApiError('Invalid Matrix access token', 401));

    await renderAt('/connect?code=ABCD-EFGH');
    await flush();

    expect(refreshToken).toHaveBeenCalledWith('refresh-a');
    expect(inspectMock.mock.calls.map((call) => call[1])).toEqual(['openid:access-b']);
    expect(getSessionStore().sessions).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
      }),
    ]);
    expect(textOf()).toContain('studio-mac');
  });

  it('offers add-account with a return to this code when no account can approve', async () => {
    storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(inspectMock).not.toHaveBeenCalled();
    await click('Sign in to approve');

    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');
    expect(textOf(renderer?.root.findByType('output'))).toBe('/login?addAccount=1');
  });

  it('offers plain login when no account is active', async () => {
    await renderAt('/connect?code=ABCD-EFGH');

    await click('Sign in to approve');

    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');
    expect(textOf(renderer?.root.findByType('output'))).toBe('/login');
  });

  it('asks for a code when the link has none and continues with the entered code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');

    await renderAt('/connect');
    expect(inspectMock).not.toHaveBeenCalled();

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'abcd efgh' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('explains an expired code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Pair code expired', 410));

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('This code has expired.');
    expect(findButton('Approve as @alice:mindroom.chat').props.disabled).toBe(true);
  });

  it('renders PairCodeForm beneath expired error so user can enter new code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Pair code expired', 410));

    await renderAt('/connect?code=ABCD-EFGH');

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'wxyz-1234' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenLastCalledWith(
      'WXYZ-1234',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('renders PairCodeForm beneath not-found error so user can enter new code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Code not found', 404));

    await renderAt('/connect?code=ABCD-EFGH');

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'new1-2345' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenLastCalledWith(
      'NEW1-2345',
      'openid:@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('shows iOS app guidance with code in no-eligible-account state', async () => {
    storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('Already signed in on the MindRoom app?');
    expect(textOf()).toContain('Settings → Local MindRoom');
    expect(textOf()).toContain('ABCD-EFGH');
    expect(() => findButton('Sign in to approve')).not.toThrow();
  });

  it('blocks approval when rendered inside a frame', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    const originalTop = window.top;
    const originalOpen = window.open;
    const mockTop = {} as Window & typeof globalThis;
    const mockOpen = vi.fn();
    Object.defineProperty(window, 'top', { value: mockTop, configurable: true });
    Object.defineProperty(window, 'open', { value: mockOpen, configurable: true });

    try {
      await renderAt('/connect?code=ABCD-EFGH');
      await flush();

      expect(textOf()).toContain(
        'For security, device approval cannot be completed inside a frame.'
      );
      expect(() => findButton('Open in new tab')).not.toThrow();
      expect(() => findButton('Approve as')).toThrow();
      expect(inspectMock).not.toHaveBeenCalled();
      expect(openIdMock).not.toHaveBeenCalled();

      await click('Open in new tab');
      expect(mockOpen).toHaveBeenCalledWith(window.location.href, '_blank', 'noopener,noreferrer');
    } finally {
      Object.defineProperty(window, 'top', { value: originalTop, configurable: true });
      Object.defineProperty(window, 'open', { value: originalOpen, configurable: true });
    }
  });

  it('shows provisioning error details for provisioning 401s without offering sign-in', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Invalid Matrix OpenID token', 401));

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('Invalid Matrix OpenID token');
    expect(textOf()).not.toContain('This account needs to sign in again');
    expect(() => findButton('Sign in to approve')).toThrow();
    expect(findButton('Approve as @alice:mindroom.chat').props.disabled).toBe(true);
  });

  it('offers sign-in when the homeserver rejects a stored token that cannot be refreshed', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    openIdMock.mockRejectedValue(new LocalMindroomApiError('Unknown token', 401));

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('This account needs to sign in again before it can approve');
    expect(() => findButton('Sign in to approve')).not.toThrow();
    await click('Sign in to approve');
    expect(textOf(renderer?.root.findByType('output'))).toBe('/login/mindroom.chat?addAccount=1');
  });
});
