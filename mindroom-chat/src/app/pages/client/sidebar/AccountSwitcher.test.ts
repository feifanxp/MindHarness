import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AccountSwitcher } from './AccountSwitcher';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => reactModule.createElement('button', { onClick, disabled }, children),
    Icon: () => reactModule.createElement('i'),
    Icons: {
      Check: 'Check',
    },
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    config: {
      space: {
        S300: '12px',
        S400: '16px',
      },
      radii: {
        R400: '12px',
      },
    },
  };
});

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: ({ userId }: { userId: string }) => React.createElement('div', null, userId),
}));

const findButtonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root.findAllByType('button').find((node) =>
    node.findAllByType('span').some((textNode) => textNode.children.join('') === text)
  );

describe('AccountSwitcher', () => {
  const activeSession = {
    sessionId: 'session-a',
    baseUrl: 'https://example.com',
    userId: '@alice:example.com',
    deviceId: 'DEVICE_A',
    accessToken: 'token-a',
    lastUsedAt: 1,
  };

  const inactiveSession = {
    sessionId: 'session-b',
    baseUrl: 'https://matrix.org',
    userId: '@bob:matrix.org',
    deviceId: 'DEVICE_B',
    accessToken: 'token-b',
    lastUsedAt: 2,
  };

  it('renders active and inactive account actions', () => {
    const renderer = create(
      React.createElement(AccountSwitcher, {
        accounts: [
          {
            session: activeSession,
            active: true,
            displayName: 'Alice',
          },
          {
            session: inactiveSession,
            active: false,
            displayName: 'Bob',
          },
        ],
        onOpenSettings: () => undefined,
        onSwitchAccount: () => undefined,
        onRemoveAccount: () => undefined,
        onAddAccount: () => undefined,
        onClose: () => undefined,
      })
    );

    expect(findButtonByText(renderer, 'Open Settings')).toBeDefined();
    expect(findButtonByText(renderer, 'Switch')).toBeDefined();
    expect(findButtonByText(renderer, 'Remove from Device')).toBeDefined();
    expect(findButtonByText(renderer, 'Add Account')).toBeDefined();
  });

  it('invokes switch and remove callbacks for inactive accounts', async () => {
    const onSwitchAccount = vi.fn();
    const onRemoveAccount = vi.fn();
    const renderer = create(
      React.createElement(AccountSwitcher, {
        accounts: [
          {
            session: activeSession,
            active: true,
            displayName: 'Alice',
          },
          {
            session: inactiveSession,
            active: false,
            displayName: 'Bob',
          },
        ],
        onOpenSettings: () => undefined,
        onSwitchAccount,
        onRemoveAccount,
        onAddAccount: () => undefined,
        onClose: () => undefined,
      })
    );

    await act(async () => {
      findButtonByText(renderer, 'Switch')?.props.onClick();
      findButtonByText(renderer, 'Remove from Device')?.props.onClick();
    });

    expect(onSwitchAccount).toHaveBeenCalledWith(inactiveSession);
    expect(onRemoveAccount).toHaveBeenCalledWith(inactiveSession);
  });

  it('omits Add Account when no add callback is provided', () => {
    const renderer = create(
      React.createElement(AccountSwitcher, {
        accounts: [
          {
            session: activeSession,
            active: true,
            displayName: 'Alice',
          },
        ],
        onOpenSettings: () => undefined,
        onSwitchAccount: () => undefined,
        onRemoveAccount: () => undefined,
        onClose: () => undefined,
      })
    );

    expect(findButtonByText(renderer, 'Add Account')).toBeUndefined();
    expect(findButtonByText(renderer, 'Close')).toBeDefined();
  });
});
