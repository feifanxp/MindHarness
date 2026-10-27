import React from 'react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { WelcomePage } from './WelcomePage';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getLocalMindroomConnections } from '../../mindroom/local-mindroom/api';
import { getWelcomeSetupFirstSeenStorageKey } from '../../mindroom/local-mindroom/mindroom';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../../mindroom/local-mindroom/settingsPage';
import { settingsModalAtom } from '../../state/settingsModal';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('div', props, children),
    Button: ({
      before,
      children,
      ...props
    }: {
      before?: React.ReactNode;
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('a', props, before, children),
    config: {
      space: {
        S400: '16px',
        S700: '28px',
      },
    },
    Icon: (props: { [key: string]: unknown }) => reactModule.createElement('icon', props),
    Icons: {
      Code: () => null,
      Info: () => null,
    },
    Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('span', props, children),
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('../../components/page', async () => {
  const reactModule = await import('react');
  const passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => reactModule.createElement('section', props, children);

  return {
    Page: passthrough,
    PageHero: passthrough,
    PageHeroSection: passthrough,
  };
});

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('../../mindroom/local-mindroom/api', () => ({
  getLocalMindroomConnections: vi.fn(),
}));

const useClientConfigMock = vi.mocked(useClientConfig);
const useMatrixClientMock = vi.mocked(useMatrixClient);
const getLocalMindroomConnectionsMock = vi.mocked(getLocalMindroomConnections);
const originalLocalStorage = globalThis.localStorage;

const createStorageMock = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });
  mockClient();
  getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [{ id: 'conn-1' }] });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  useClientConfigMock.mockReset();
  useMatrixClientMock.mockReset();
  getLocalMindroomConnectionsMock.mockReset();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

const mockClient = () => {
  useMatrixClientMock.mockReturnValue({
    getAccessToken: () => 'matrix-token',
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@alice:mindroom.chat',
    getCrypto: () => undefined,
    getOpenIdToken: async () => ({
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'mindroom.chat',
      expires_in: 3600,
    }),
  } as unknown as ReturnType<typeof useMatrixClient>);
};

const mockWelcomeConfig = () => {
  useClientConfigMock.mockReturnValue({
    sidebar: {
      mindRoomUrl: 'https://docs.mindroom.chat/',
    },
    welcome: {
      docsUrl: 'https://docs.example.test',
      docsLabel: 'Docs',
      sourceUrl: 'https://source.example.test',
      sourceLabel: 'Source',
    },
  });
};

describe('WelcomePage', () => {
  it('renders docs button when docsUrl is set and icons are safe', () => {
    useClientConfigMock.mockReturnValue({
      welcome: {
        docsUrl: 'https://docs.example.test',
        docsLabel: 'Docs',
        sourceUrl: 'https://source.example.test',
        sourceLabel: 'Source',
      },
    });

    const renderer = create(React.createElement(WelcomePage));

    const docsLinks = renderer.root.findAll(
      (node) => node.props?.href === 'https://docs.example.test'
    );
    expect(docsLinks.length).toBeGreaterThan(0);

    const iconNodes = renderer.root.findAll((node) => node.props?.src && node.props?.size);
    expect(iconNodes.length).toBeGreaterThan(0);
    iconNodes.forEach((node) => {
      expect(typeof node.props.src).toBe('function');
    });
  });

  it('does not render docs button when docsUrl is empty', () => {
    useClientConfigMock.mockReturnValue({
      welcome: {
        docsUrl: '',
        docsLabel: 'Docs',
        sourceUrl: 'https://source.example.test',
      },
    });

    const renderer = create(React.createElement(WelcomePage));

    const docsLinks = renderer.root.findAll(
      (node) => node.props?.href === 'https://docs.example.test'
    );
    expect(docsLinks.length).toBe(0);

    const emptyDocsLinks = renderer.root.findAll((node) => node.props?.href === '');
    expect(emptyDocsLinks.length).toBe(0);
  });

  it('renders setup instructions after one day without a paired Local MindRoom device', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    mockClient();
    mockWelcomeConfig();
    localStorage.setItem(
      getWelcomeSetupFirstSeenStorageKey('@alice:mindroom.chat'),
      Date.parse('2026-05-14T11:59:59.000Z').toString()
    );
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [] });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(WelcomePage));
    });

    expect(getLocalMindroomConnectionsMock).toHaveBeenCalledWith(
      'openid-token',
      'https://mindroom.chat'
    );
    const text = renderer!.root.findAllByType('span').map((node) => node.children.join(' '));
    expect(text).toContain('Set up Local MindRoom');
    expect(text).toContain(
      '1. Run uvx mindroom config init --provider <anthropic|codex|llama.cpp|ollama|openai|openrouter|vertexai_claude>'
    );
    expect(text).toContain('2. Add model credentials in ~/.mindroom/.env, or run codex login');
    expect(text).toContain(
      '3. Start it with uvx mindroom run, then open the link it prints to approve the connection'
    );
    expect(text).toContain('Have a code? Enter it in Local MindRoom');
    expect(text.join('\n')).not.toContain('mindroom connect');
  });

  it('updates setup instruction prose when the language changes without changing commands', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    mockClient();
    mockWelcomeConfig();
    localStorage.setItem(
      getWelcomeSetupFirstSeenStorageKey('@alice:mindroom.chat'),
      Date.parse('2026-05-14T11:59:59.000Z').toString()
    );
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [] });
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              welcomePage: {
                setupStep1: '1. Run {{command}}',
                setupStep2: '2. Add model credentials in {{envFile}}, or run {{command}}',
                setupStep3: '3. Start it with {{command}}',
              },
            },
          },
        },
        de: {
          translation: {
            sharedUi: {
              welcomePage: {
                setupStep1: '1. Führe {{command}} aus',
                setupStep2: '2. Hinterlege Zugangsdaten in {{envFile}} oder führe {{command}} aus',
                setupStep3: '3. Starte es mit {{command}}',
              },
            },
          },
        },
      },
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(I18nextProvider, { i18n: language }, React.createElement(WelcomePage))
      );
    });

    await act(async () => {
      await language.changeLanguage('de');
    });

    const text = renderer!.root.findAllByType('span').map((node) => node.children.join(' '));
    expect(text).toContain(
      '1. Führe uvx mindroom config init --provider <anthropic|codex|llama.cpp|ollama|openai|openrouter|vertexai_claude> aus'
    );
    expect(text).toContain(
      '2. Hinterlege Zugangsdaten in ~/.mindroom/.env oder führe codex login aus'
    );
    expect(text).toContain('3. Starte es mit uvx mindroom run');
  });

  it('opens Local MindRoom settings from the setup instructions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    mockClient();
    mockWelcomeConfig();
    localStorage.setItem(
      getWelcomeSetupFirstSeenStorageKey('@alice:mindroom.chat'),
      Date.parse('2026-05-14T11:59:59.000Z').toString()
    );
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [] });
    const store = createStore();

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Provider, { store }, React.createElement(WelcomePage)));
    });

    const setupButton = renderer!.root.find(
      (node) => node.props['aria-label'] === 'Open Local MindRoom settings'
    );

    await act(async () => {
      setupButton.props.onClick();
    });

    expect(store.get(settingsModalAtom)).toEqual({
      initialPage: LOCAL_MINDROOM_SETTINGS_PAGE,
    });
  });

  it('does not query provisioning for an account whose token it may not forward', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    useMatrixClientMock.mockReturnValue({
      getAccessToken: () => 'matrix-org-token',
      getHomeserverUrl: () => 'https://matrix-client.matrix.org',
      getSafeUserId: () => '@bob:matrix.org',
      getCrypto: () => undefined,
    } as ReturnType<typeof useMatrixClient>);
    useClientConfigMock.mockReturnValue({
      sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' },
      welcome: {},
    });
    localStorage.setItem(
      getWelcomeSetupFirstSeenStorageKey('@bob:matrix.org'),
      Date.parse('2026-05-14T11:59:59.000Z').toString()
    );
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [] });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(WelcomePage));
    });

    expect(getLocalMindroomConnectionsMock).not.toHaveBeenCalled();
    const text = renderer!.root.findAllByType('span').map((node) => node.children.join(' '));
    expect(text).not.toContain('Set up Local MindRoom');
  });

  it('does not render setup instructions before the one-day grace period or with a paired device', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    mockClient();
    mockWelcomeConfig();
    const storageKey = getWelcomeSetupFirstSeenStorageKey('@alice:mindroom.chat');
    localStorage.setItem(storageKey, Date.parse('2026-05-14T12:00:01.000Z').toString());
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [] });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(WelcomePage));
    });

    let setupHeadings = renderer!.root.findAll(
      (node) => node.children.join(' ') === 'Set up Local MindRoom'
    );
    expect(setupHeadings.length).toBe(0);

    await act(async () => {
      renderer!.unmount();
    });

    localStorage.setItem(storageKey, Date.parse('2026-05-14T11:59:59.000Z').toString());
    getLocalMindroomConnectionsMock.mockResolvedValue({ connections: [{ id: 'conn-1' }] });

    await act(async () => {
      renderer = create(React.createElement(WelcomePage));
    });

    setupHeadings = renderer!.root.findAll(
      (node) => node.children.join(' ') === 'Set up Local MindRoom'
    );
    expect(setupHeadings.length).toBe(0);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
