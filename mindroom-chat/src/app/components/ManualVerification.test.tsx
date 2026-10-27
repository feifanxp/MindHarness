import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualVerificationTile } from './ManualVerification';

const mocks = vi.hoisted(() => ({
  error: new Error(),
  retry: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  Chip: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Icon: () => null,
  Icons: { ChevronBottom: 'chevron-bottom' },
  Menu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  PopOut: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' }, Success: { Main: 'green' } },
  config: { space: { S100: '4px' } },
}));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./setting-tile', () => ({
  SettingTile: ({ title, description, after }: Record<string, React.ReactNode>) => (
    <div>
      {title}
      {description}
      {after}
    </div>
  ),
}));
vi.mock('./SecretStorage', () => ({
  SecretStorageRecoveryKey: () => null,
  SecretStorageRecoveryPassphrase: () => null,
}));
vi.mock('../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAsyncCallback')>(
    '../hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: () => [{ status: actual.AsyncStatus.Error, error: mocks.error }, mocks.retry],
  };
});
vi.mock('../../client/secretStorageKeys', () => ({ storePrivateKey: vi.fn() }));

const createLanguage = async () => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: {
          sharedUi: { deviceVerificationSetup: { unexpectedError: 'Unexpected Error!' } },
        },
      },
      de: {
        translation: {
          sharedUi: { deviceVerificationSetup: { unexpectedError: 'Unerwarteter Fehler!' } },
        },
      },
    },
  });
  return language;
};

describe('ManualVerification retained errors', () => {
  beforeEach(() => {
    mocks.retry.mockClear();
  });

  it('updates its internal failure after a language change without retrying', async () => {
    mocks.error = new Error('Unexpected Error! Crypto object not found.');
    const language = await createLanguage();
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <ManualVerificationTile secretStorageKeyId="key" secretStorageKeyContent={{}} />
        </I18nextProvider>
      );
    });

    expect(renderer.root.findByType('b').children.join('')).toBe('Unexpected Error!');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(renderer.root.findByType('b').children.join('')).toBe('Unerwarteter Fehler!');
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it('preserves an unrelated verification error', () => {
    mocks.error = new Error('Homeserver unavailable');
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ManualVerificationTile secretStorageKeyId="key" secretStorageKeyContent={{}} />
      );
    });

    expect(renderer.root.findByType('b').children.join('')).toBe('Homeserver unavailable');
  });
});
