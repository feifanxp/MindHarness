import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { PasswordResetForm } from './PasswordResetForm';

vi.mock('folds', () => ({
  Box: ({ as = 'div', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Overlay: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  OverlayBackdrop: () => null,
  OverlayCenter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Spinner: () => null,
  Text: ({ as = 'span', children, ...props }: { as?: string; children?: React.ReactNode }) =>
    React.createElement(as, props, children),
  color: { Critical: { Main: 'red' } },
  config: { space: { S400: '16px' } },
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: () => ({ generateClientSecret: () => 'secret' }),
}));
vi.mock('../../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => ({ 'm.homeserver': { base_url: 'https://example.test' } }),
}));
vi.mock('../../../hooks/useAuthServer', () => ({ useAuthServer: () => 'example.test' }));
vi.mock('../../../hooks/usePasswordEmail', async () => {
  const { AsyncStatus } = await import('../../../hooks/useAsyncCallback');
  return { usePasswordEmail: () => [{ status: AsyncStatus.Idle }, vi.fn()] };
});
vi.mock('../../../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useAsyncCallback')>(
    '../../../hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: () => [
      { status: actual.AsyncStatus.Error, error: { errcode: 'M_UNKNOWN', data: {} } },
      vi.fn(),
    ],
  };
});
vi.mock('../../../components/password-input', () => ({
  PasswordInput: React.forwardRef((props, ref) => <input ref={ref} {...props} />),
}));
vi.mock('../../../components/ConfirmPasswordMatch', () => ({
  ConfirmPasswordMatch: ({ children }: { children: (...args: unknown[]) => React.ReactNode }) =>
    children(true, vi.fn(), React.createRef(), React.createRef()),
}));
vi.mock('../FiledError', () => ({
  FieldError: ({ message }: { message: string }) => <div data-field-error={message} />,
}));
vi.mock('../../../components/UIAFlowOverlay', () => ({ UIAFlowOverlay: () => null }));
vi.mock('../../../components/uia-stages', () => ({ EmailStageDialog: () => null }));

describe('PasswordResetForm', () => {
  it('updates the generic reset failure after a language change', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            sharedUi: {
              passwordResetForm: { failedToResetPassword: 'Failed to reset password.' },
            },
          },
        },
        de: {
          translation: {
            sharedUi: {
              passwordResetForm: {
                failedToResetPassword: 'Passwort konnte nicht zurückgesetzt werden.',
              },
            },
          },
        },
      },
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <I18nextProvider i18n={language}>
          <PasswordResetForm />
        </I18nextProvider>
      );
    });

    expect(
      renderer!.root.findByProps({
        'data-field-error': 'M_UNKNOWN: Failed to reset password.',
      })
    ).toBeDefined();
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(
      renderer!.root.findByProps({
        'data-field-error': 'M_UNKNOWN: Passwort konnte nicht zurückgesetzt werden.',
      })
    ).toBeDefined();
  });
});
