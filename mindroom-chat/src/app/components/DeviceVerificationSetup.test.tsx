import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceVerificationSetup } from './DeviceVerificationSetup';

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
  Chip: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Header: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  Icon: () => null,
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Icons: { Cross: 'cross' },
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' } },
  config: {
    borderWidth: { B300: '1px' },
    radii: { R400: '4px' },
    space: { S100: '4px', S200: '8px', S300: '12px', S400: '16px' },
  },
}));
vi.mock('file-saver', () => ({ default: { saveAs: vi.fn() } }));
vi.mock('./password-input', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('./ActionUIA', () => ({
  ActionUIA: () => null,
  ActionUIAFlowsLoader: () => null,
}));
vi.mock('../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
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
vi.mock('../../client/secretStorageKeys', () => ({ clearSecretStorageKeys: vi.fn() }));
vi.mock('../utils/dom', () => ({ copyToClipboard: vi.fn() }));
vi.mock('../styles/ContainerColor.css', () => ({ ContainerColor: () => '' }));

const internalErrors = [
  'Unexpected Error! UIA action is perform without data.',
  'Authentication failed! Failed to setup device verification.',
  'Unexpected Error! Crypto module not found!',
  'Unexpected Error! Failed to create recovery key.',
];

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

describe('DeviceVerificationSetup retained errors', () => {
  beforeEach(() => {
    mocks.retry.mockClear();
  });

  it.each(internalErrors)(
    'updates the internal failure after a language change without retrying: %s',
    async (message) => {
      mocks.error = new Error(message);
      const language = await createLanguage();
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <I18nextProvider i18n={language}>
            <DeviceVerificationSetup onCancel={vi.fn()} />
          </I18nextProvider>
        );
      });

      expect(renderer.root.findByType('b').children.join('')).toBe('Unexpected Error!');
      await act(async () => {
        await language.changeLanguage('de');
      });
      expect(renderer.root.findByType('b').children.join('')).toBe('Unerwarteter Fehler!');
      expect(mocks.retry).not.toHaveBeenCalled();
    }
  );

  it('preserves an unrelated setup error', () => {
    mocks.error = new Error('Homeserver unavailable');
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<DeviceVerificationSetup onCancel={vi.fn()} />);
    });

    expect(renderer.root.findAllByType('b').at(-1)?.children.join('')).toBe(
      'Homeserver unavailable'
    );
  });
});
