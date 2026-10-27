import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Room, RoomMember } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Membership } from '../../../types/matrix/room';
import { JoinRequestItem } from './JoinRequestItem';

const { mx } = vi.hoisted(() => ({
  mx: {
    invite: vi.fn(),
    kick: vi.fn(),
  },
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', props, children),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', { type: 'button', ...props }, children),
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    Icons: {
      Check: 'Check',
      User: 'User',
    },
    Spinner: () => reactModule.createElement('span', { 'data-testid': 'spinner' }),
    Text: ({
      as,
      children,
      ...props
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      children?: React.ReactNode;
    }) => reactModule.createElement(as ?? 'span', props, children),
    color: {
      Critical: {
        Main: 'red',
      },
    },
    config: {
      space: {
        S100: '4px',
        S200: '8px',
      },
    },
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: () => '5m ago',
}));

vi.mock('../../components/user-avatar', () => ({
  UserAvatar: () => React.createElement('div', { 'data-testid': 'avatar' }),
}));

vi.mock('../../utils/matrix', () => ({
  getMxIdLocalPart: (userId: string) => userId.split(':')[0]?.slice(1),
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../utils/room', () => ({
  getMemberDisplayName: () => 'Alice',
}));

vi.mock('../../styles/Text.css', () => ({
  BreakWord: 'BreakWord',
}));

vi.mock('./MembersDrawer.css', () => ({
  JoinRequestActions: 'JoinRequestActions',
  JoinRequestItem: 'JoinRequestItem',
  JoinRequestMessage: 'JoinRequestMessage',
}));

const createRoom = (): Room => ({ roomId: '!room:example.org' } as Room);

const createKnockingMember = (reason: unknown = 'I would love to join.'): RoomMember =>
  ({
    userId: '@alice:example.org',
    membership: Membership.Knock,
    getMxcAvatarUrl: () => undefined,
    events: {
      member: {
        getContent: () => ({ membership: Membership.Knock, reason }),
        getId: () => '$knock',
        getTs: () => 123,
      },
    },
  } as unknown as RoomMember);

const renderItem = (
  options: { canApprove?: boolean; canDecline?: boolean; reason?: unknown } = {}
): ReactTestRenderer =>
  create(
    <JoinRequestItem
      room={createRoom()}
      member={createKnockingMember(options.reason)}
      canApprove={options.canApprove ?? true}
      canDecline={options.canDecline ?? true}
    />
  );

const textContent = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ');

afterEach(() => {
  mx.invite.mockReset();
  mx.kick.mockReset();
});

describe('JoinRequestItem', () => {
  it('shows the requester identity, message, age, and available actions', () => {
    const renderer = renderItem();

    expect(textContent(renderer)).toContain('Alice');
    expect(textContent(renderer)).toContain('@alice:example.org');
    expect(textContent(renderer)).toContain('I would love to join.');
    expect(textContent(renderer)).toContain('5m ago');
    expect(
      renderer.root.findByProps({
        'aria-label': 'Approve join request from @alice:example.org',
      })
    ).toBeDefined();
    expect(
      renderer.root.findByProps({
        'aria-label': 'Decline join request from @alice:example.org',
      })
    ).toBeDefined();
  });

  it('ignores a malformed non-string request message', () => {
    const renderer = renderItem({ reason: { unexpected: true } });

    expect(textContent(renderer)).toContain('No message provided.');
  });

  it('keeps an approved request settled until membership sync removes the row', async () => {
    let resolveInvite: (() => void) | undefined;
    mx.invite.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvite = resolve;
      })
    );
    const renderer = renderItem();
    const approve = renderer.root.findByProps({
      'aria-label': 'Approve join request from @alice:example.org',
    });
    const decline = renderer.root.findByProps({
      'aria-label': 'Decline join request from @alice:example.org',
    });

    await act(async () => {
      approve.props.onClick();
      await Promise.resolve();
    });

    expect(mx.invite).toHaveBeenCalledWith('!room:example.org', '@alice:example.org');
    expect(approve.props.disabled).toBe(true);
    expect(decline.props.disabled).toBe(true);
    expect(textContent(renderer)).toContain('Approving…');

    await act(async () => {
      resolveInvite?.();
      await Promise.resolve();
    });

    expect(textContent(renderer)).toContain('Approved. Waiting for room sync…');
    expect(approve.props.disabled).toBe(true);
    expect(decline.props.disabled).toBe(true);
  });

  it('shows an inline error and retries the failed action', async () => {
    mx.invite.mockRejectedValueOnce(new Error('Request failed')).mockResolvedValueOnce({});
    const renderer = renderItem();
    const approve = renderer.root.findByProps({
      'aria-label': 'Approve join request from @alice:example.org',
    });

    await act(async () => {
      approve.props.onClick();
      await Promise.resolve();
    });

    expect(textContent(renderer)).toContain('Request failed');
    expect(approve.props.disabled).toBe(false);

    await act(async () => {
      approve.props.onClick();
      await Promise.resolve();
    });

    expect(mx.invite).toHaveBeenCalledTimes(2);
    expect(textContent(renderer)).toContain('Approved. Waiting for room sync…');
  });

  it('declines through the Matrix kick endpoint and hides unauthorized actions', async () => {
    mx.kick.mockResolvedValue({});
    const renderer = renderItem({ canApprove: false });
    const decline = renderer.root.findByProps({
      'aria-label': 'Decline join request from @alice:example.org',
    });

    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Approve join request from @alice:example.org',
      })
    ).toHaveLength(0);

    await act(async () => {
      decline.props.onClick();
      await Promise.resolve();
    });

    expect(mx.kick).toHaveBeenCalledWith('!room:example.org', '@alice:example.org');
    expect(textContent(renderer)).toContain('Declined. Waiting for room sync…');
  });
});
