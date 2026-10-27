import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfig, ClientConfigProvider } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { dismissKeyBackupNudge, readKeyBackupNudgeDismissed } from './keyBackupNudgeDismissal';
import { useKeyBackupPresence } from './useKeyBackupPresence';
import { KeyBackupNudge } from './KeyBackupNudge';

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('./useKeyBackupPresence', () => ({
  useKeyBackupPresence: vi.fn(),
}));

const useMatrixClientMock = vi.mocked(useMatrixClient);
const useKeyBackupPresenceMock = vi.mocked(useKeyBackupPresence);

const USER_ID = '@alice:example.org';

const makeMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  };
};

const mockClient = () =>
  ({
    getCrypto: () => ({}),
    getSafeUserId: () => USER_ID,
  } as unknown as ReturnType<typeof useMatrixClient>);

const renderNudge = async (clientConfig: ClientConfig = {}): Promise<ReactTestRenderer> => {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      React.createElement(
        ClientConfigProvider,
        { value: clientConfig },
        React.createElement(KeyBackupNudge)
      )
    );
  });
  return renderer as ReactTestRenderer;
};

// The visibility gate ties the two tested units together: an inverted or
// widened condition here would push the nudge in front of users who already
// have backup — the exact harm the three-state presence hook exists to
// prevent — so the gate is pinned by rendering, not only by unit tests.
describe('KeyBackupNudge visibility gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useMatrixClientMock.mockReset();
    useKeyBackupPresenceMock.mockReset();
  });

  it('renders nothing while backup presence is unknown or already present', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    useMatrixClientMock.mockReturnValue(mockClient());

    useKeyBackupPresenceMock.mockReturnValue('unknown');
    expect((await renderNudge()).toJSON()).toBeNull();

    useKeyBackupPresenceMock.mockReturnValue('present');
    expect((await renderNudge()).toJSON()).toBeNull();
  });

  it('shows the nudge only when the server confirmed there is no backup', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    useMatrixClientMock.mockReturnValue(mockClient());
    useKeyBackupPresenceMock.mockReturnValue('absent');

    const renderer = await renderNudge();

    expect(renderer.toJSON()).not.toBeNull();
    expect(renderer.root.findByProps({ 'aria-label': 'Set up secure key backup' })).toBeDefined();
  });

  it('skips the backup check when room encryption is disabled by policy', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    useMatrixClientMock.mockReturnValue(mockClient());
    useKeyBackupPresenceMock.mockReturnValue('absent');

    const renderer = await renderNudge({
      createRoom: {
        showEncryptionOption: false,
        defaultEncryption: false,
      },
    });

    expect(renderer.toJSON()).toBeNull();
    expect(useKeyBackupPresenceMock).not.toHaveBeenCalled();
  });

  it('shows when the encryption control is hidden but encryption is enabled by policy', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    useMatrixClientMock.mockReturnValue(mockClient());
    useKeyBackupPresenceMock.mockReturnValue('absent');

    const renderer = await renderNudge({
      createRoom: {
        showEncryptionOption: false,
        defaultEncryption: true,
      },
    });

    expect(renderer.toJSON()).not.toBeNull();
    expect(renderer.root.findByProps({ 'aria-label': 'Set up secure key backup' })).toBeDefined();
  });

  it('renders nothing when the user already dismissed it, even with no backup', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    dismissKeyBackupNudge(USER_ID);
    useMatrixClientMock.mockReturnValue(mockClient());
    useKeyBackupPresenceMock.mockReturnValue('absent');

    expect((await renderNudge()).toJSON()).toBeNull();
  });

  it('hides after the dismiss button and persists the dismissal', async () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());
    useMatrixClientMock.mockReturnValue(mockClient());
    useKeyBackupPresenceMock.mockReturnValue('absent');

    const renderer = await renderNudge();
    const dismissButton = renderer.root.findByProps({ 'aria-label': 'Dismiss backup reminder' });
    await act(async () => {
      dismissButton.props.onClick();
    });

    expect(renderer.toJSON()).toBeNull();
    expect(readKeyBackupNudgeDismissed(USER_ID)).toBe(true);
  });
});
