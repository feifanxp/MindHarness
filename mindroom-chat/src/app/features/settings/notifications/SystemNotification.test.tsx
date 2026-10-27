import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { SystemNotification } from './SystemNotification';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setPusher: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  color: { Critical: { Main: 'red' } },
  Spinner: () => null,
  Switch: ({ onChange, value }: { onChange: (value: boolean) => void; value: boolean }) => (
    <button
      type="button"
      aria-label="Mock notification switch"
      data-switch-value={value}
      onClick={() => onChange(true)}
    />
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../../../components/sequence-card', () => ({
  SequenceCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../../components/setting-tile', () => ({
  SettingTile: ({
    after,
    description,
    title,
  }: {
    after?: React.ReactNode;
    description?: React.ReactNode;
    title: string;
  }) => (
    <section data-setting-title={title}>
      {description}
      {after}
    </section>
  ),
}));
vi.mock('../../../state/hooks/settings', () => ({ useSetting: () => [false, vi.fn()] }));
vi.mock('../../../hooks/usePermission', () => ({
  getNotificationState: () => 'granted',
  usePermissionState: () => 'granted',
}));
vi.mock('../../../hooks/useEmailNotifications', () => ({
  useEmailNotifications: () => [{ email: 'alice@example.test', enabled: false }, mocks.refresh],
}));
vi.mock('../../../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useAsyncCallback')>(
    '../../../hooks/useAsyncCallback'
  );
  return {
    ...actual,
    useAsyncCallback: (callback: (...args: unknown[]) => Promise<unknown>) => [
      { status: actual.AsyncStatus.Idle },
      callback,
    ],
  };
});
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ setPusher: mocks.setPusher }),
}));
vi.mock('../../../mindroom/notifications/SystemNotificationMindroomExtensions', () => ({
  getMindroomEmailNotificationPusherData: () => ({ brand: 'MindRoom Chat' }),
  MindroomNativeNotificationSettings: () => null,
}));
vi.mock('../styles.css', () => ({ SequenceCardStyle: 'card' }));

describe('SystemNotification email pusher', () => {
  it('uses the active normalized app language when enabling email notifications', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: {
          translation: {
            featureUi: {
              settings: {
                notifications: { systemNotification: { emailNotification: 'Email' } },
              },
            },
          },
        },
        de: {
          translation: {
            featureUi: {
              settings: {
                notifications: { systemNotification: { emailNotification: 'E-Mail' } },
              },
            },
          },
        },
      },
    });
    const renderer = create(
      <I18nextProvider i18n={language}>
        <SystemNotification />
      </I18nextProvider>
    );

    await act(async () => {
      renderer.root
        .findByProps({ 'data-setting-title': 'Email' })
        .findByType('button')
        .props.onClick();
      await Promise.resolve();
    });
    expect(mocks.setPusher).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'en' }));

    await act(async () => {
      await language.changeLanguage('de-DE');
    });
    await act(async () => {
      renderer.root
        .findByProps({ 'data-setting-title': 'E-Mail' })
        .findByType('button')
        .props.onClick();
      await Promise.resolve();
    });
    expect(mocks.setPusher).toHaveBeenLastCalledWith(expect.objectContaining({ lang: 'de' }));
  });
});
