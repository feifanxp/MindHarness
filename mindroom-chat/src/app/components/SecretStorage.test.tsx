import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretStorageRecoveryKey, SecretStorageRecoveryPassphrase } from './SecretStorage';

const mocks = vi.hoisted(() => ({
  error: new Error(),
  retry: vi.fn(),
}));

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' } },
}));
vi.mock('./password-input', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ secretStorage: { checkKey: vi.fn() } }),
}));
vi.mock('../hooks/useAlive', () => ({ useAlive: () => () => true }));
vi.mock('../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useAsyncCallback')>(
    '../hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: () => [{ status: actual.AsyncStatus.Error, error: mocks.error }, mocks.retry],
  };
});

const createLanguage = async () => {
  const language = createInstance();
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: {
          sharedUi: {
            secretStorage: {
              invalidRecoveryPassphrase: 'Invalid recovery passphrase.',
              invalidRecoveryKey: 'Invalid recovery key.',
            },
          },
        },
      },
      de: {
        translation: {
          sharedUi: {
            secretStorage: {
              invalidRecoveryPassphrase: 'Ungültige Wiederherstellungs-Passphrase.',
              invalidRecoveryKey: 'Ungültiger Wiederherstellungsschlüssel.',
            },
          },
        },
      },
    },
  });
  return language;
};

describe('SecretStorage retained errors', () => {
  beforeEach(() => {
    mocks.retry.mockClear();
  });

  it('updates an invalid recovery passphrase after a language change without retrying', async () => {
    mocks.error = new Error('Invalid recovery passphrase.');
    const language = await createLanguage();
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <SecretStorageRecoveryPassphrase
            keyContent={{}}
            passphraseContent={{ algorithm: '', salt: '', iterations: 1, bits: 1 }}
            onDecodedRecoveryKey={vi.fn()}
          />
        </I18nextProvider>
      );
    });

    expect(renderer.root.findByType('b').children.join('')).toBe('Invalid recovery passphrase.');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(renderer.root.findByType('b').children.join('')).toBe(
      'Ungültige Wiederherstellungs-Passphrase.'
    );
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it('updates an invalid recovery key after a language change without retrying', async () => {
    mocks.error = new Error('Invalid recovery key.');
    const language = await createLanguage();
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <SecretStorageRecoveryKey keyContent={{}} onDecodedRecoveryKey={vi.fn()} />
        </I18nextProvider>
      );
    });

    expect(renderer.root.findByType('b').children.join('')).toBe('Invalid recovery key.');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(renderer.root.findByType('b').children.join('')).toBe(
      'Ungültiger Wiederherstellungsschlüssel.'
    );
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it('preserves an unrelated recovery error', () => {
    mocks.error = new Error('Homeserver unavailable');
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <SecretStorageRecoveryKey keyContent={{}} onDecodedRecoveryKey={vi.fn()} />
      );
    });

    expect(renderer.root.findByType('b').children.join('')).toBe('Homeserver unavailable');
  });
});
