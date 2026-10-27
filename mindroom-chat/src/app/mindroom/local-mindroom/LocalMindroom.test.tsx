// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMindroom } from './LocalMindroom';
import { getLocalMindroomConnections, revokeLocalMindroomConnection } from './api';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';

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
    Icon: () => null,
    IconButton: element('button'),
    Icons: { Cross: 'cross' },
    Input: (props: Props) => reactModule.createElement('input', props),
    Scroll: element('div'),
    Spinner: () => null,
    Text: element('span'),
    color: {
      Critical: { Main: 'critical' },
      Secondary: { Main: 'secondary' },
      Success: { Main: 'success' },
      Warning: { Main: 'warning' },
    },
  };
});

vi.mock('../../components/page', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('section', null, children);
  return {
    Page: passthrough,
    PageContent: passthrough,
    PageHeader: passthrough,
    PageScroll: ({ header, children }: React.PropsWithChildren<{ header?: React.ReactNode }>) =>
      reactModule.createElement('section', null, header, children),
  };
});

vi.mock('../../components/sequence-card', async () => {
  const reactModule = await import('react');
  return {
    SequenceCard: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
  };
});

vi.mock('../../components/setting-tile', async () => {
  const reactModule = await import('react');
  return {
    SettingTile: ({ title, description }: { title?: string; description?: React.ReactNode }) =>
      reactModule.createElement('div', null, title, description),
  };
});

vi.mock('../../features/settings/styles.css', () => ({
  SequenceCardStyle: 'SequenceCardStyle',
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  getLocalMindroomConnections: vi.fn(),
  revokeLocalMindroomConnection: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

const textOf = (node: ReactTestInstance | undefined): string =>
  (node?.children ?? [])
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');

let renderer: ReactTestRenderer | undefined;
const getOpenIdTokenMock = vi.fn();

const findButton = (label: string) =>
  renderer!.root.findAll((node) => node.type === 'button' && textOf(node).trim() === label, {
    deep: true,
  })[0];

beforeEach(() => {
  vi.mocked(useClientConfig).mockReturnValue({ sidebar: {} });
  vi.mocked(useMatrixClient).mockReturnValue({
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token',
    getOpenIdToken: getOpenIdTokenMock,
  } as never);
  getOpenIdTokenMock.mockResolvedValue({
    access_token: 'openid-token',
    token_type: 'Bearer',
    matrix_server_name: 'mindroom.chat',
    expires_in: 3600,
  });
  vi.mocked(getLocalMindroomConnections).mockResolvedValue({ connections: [] });
  vi.mocked(revokeLocalMindroomConnection).mockResolvedValue();
});

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  vi.clearAllMocks();
});

describe('LocalMindroom settings', () => {
  it('opens the connect page for an entered code and closes settings', async () => {
    const onNavigate = vi.fn();

    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={['/home/']}>
          <Routes>
            <Route
              path="/home/"
              element={<LocalMindroom requestClose={vi.fn()} onNavigate={onNavigate} />}
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(textOf(renderer?.root)).toContain('uvx mindroom run');
    expect(textOf(renderer?.root)).not.toContain('Generate Pair Code');

    await act(async () => {
      renderer!.root.findByType('input').props.onChange({ currentTarget: { value: 'abcdefgh' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(textOf(renderer?.root.findByType('output'))).toBe('/connect?code=ABCD-EFGH');
  });

  it('explains that linked installations are unavailable instead of querying another provisioning origin', async () => {
    vi.mocked(useClientConfig).mockReturnValue({
      sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' },
    });
    vi.mocked(useMatrixClient).mockReturnValue({
      getHomeserverUrl: () => 'https://matrix-client.matrix.org',
      getAccessToken: () => 'matrix-org-token',
    } as never);

    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <LocalMindroom requestClose={vi.fn()} onNavigate={vi.fn()} />
        </MemoryRouter>
      );
    });

    expect(getLocalMindroomConnections).not.toHaveBeenCalled();
    const text = textOf(renderer?.root);
    expect(text).toContain(
      'Linked installations are only available for accounts on mindroom.chat.'
    );
    expect(text).not.toContain('Access token forwarding');
    expect(text).not.toContain('No linked local MindRoom installations yet.');
    expect(renderer!.root.findAllByType('input')).toHaveLength(1);
  });

  it('lists and revokes installations with an OpenID token instead of the access token', async () => {
    vi.mocked(getLocalMindroomConnections).mockResolvedValue({
      connections: [{ id: 'conn-1', client_name: 'studio-mac' }],
    });

    await act(async () => {
      renderer = create(
        <MemoryRouter>
          <LocalMindroom requestClose={vi.fn()} onNavigate={vi.fn()} />
        </MemoryRouter>
      );
    });

    expect(getLocalMindroomConnections).toHaveBeenCalledWith(
      'openid-token',
      'https://mindroom.chat'
    );
    expect(textOf(renderer?.root)).toContain('studio-mac');

    await act(async () => {
      findButton('Revoke').props.onClick();
    });
    await act(async () => {
      findButton('Confirm Revoke').props.onClick();
    });

    expect(revokeLocalMindroomConnection).toHaveBeenCalledWith(
      'conn-1',
      'openid-token',
      'https://mindroom.chat'
    );
    const tokensSent = [
      ...vi.mocked(getLocalMindroomConnections).mock.calls.map((call) => call[0]),
      ...vi.mocked(revokeLocalMindroomConnection).mock.calls.map((call) => call[1]),
    ];
    expect(tokensSent).not.toContain('token');
  });
});
