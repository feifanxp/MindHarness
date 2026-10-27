import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { JoinBeforeNavigate } from './JoinBeforeNavigate';

const summaryLoaderMock = vi.hoisted(() => ({
  state: undefined as unknown,
  props: undefined as unknown,
  retry: vi.fn(),
  resolvedViaServers: undefined as string[] | undefined,
}));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({
      open,
      children,
      backdrop,
    }: {
      open?: boolean;
      children?: React.ReactNode;
      backdrop?: React.ReactNode;
    }) => (open ? React.createElement(React.Fragment, null, backdrop, children) : null),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Scroll: Wrapper,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => children,
  PageHeader: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../components/room-card/style.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

vi.mock('../../components/RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    children,
    ...props
  }: {
    children: (state: unknown, retry: () => void, viaServers?: string[]) => React.ReactNode;
    roomIdOrAlias: string;
    viaServers?: string[];
  }) => {
    summaryLoaderMock.props = props;
    return children(
      summaryLoaderMock.state,
      summaryLoaderMock.retry,
      summaryLoaderMock.resolvedViaServers
    );
  },
}));

vi.mock('../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
  }),
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../mindroom/native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    children(vi.fn()),
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtomValue: () => [],
  };
});

const mx = {
  getRoom: vi.fn(() => null),
  joinRoom: vi.fn(),
  knockRoom: vi.fn(),
  mxcUrlToHttp: vi.fn(() => 'https://example.org/media/private'),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

describe('JoinBeforeNavigate room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryLoaderMock.resolvedViaServers = undefined;
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!private:example.org',
        name: 'Private room',
        avatar_url: 'mxc://example.org/private',
        topic: 'Private discussion',
        canonical_alias: '#private:example.org',
        world_readable: false,
        guest_can_join: false,
        num_joined_members: 12,
        join_rule: JoinRule.Knock,
        membership: 'leave',
      },
    };
  });

  it('knocks on an alias through its resolved room and routing servers', async () => {
    summaryLoaderMock.resolvedViaServers = ['resident.example.org'];
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="#private:example.org" />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(summaryLoaderMock.props).toEqual({
      roomIdOrAlias: '#private:example.org',
      viaServers: undefined,
    });

    const requestButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );
    act(() => requestButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });

    expect(mx.knockRoom).toHaveBeenCalledWith('!private:example.org', {
      reason: undefined,
      viaServers: ['resident.example.org'],
    });
  });

  it('joins an alias through its resolved room and routing servers', async () => {
    summaryLoaderMock.resolvedViaServers = ['resident.example.org'];
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!public:example.org',
        name: 'Public room',
        join_rule: JoinRule.Public,
        membership: 'leave',
      },
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="#public:example.org" />
        </MatrixClientProvider>
      );
    });
    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    await act(async () => {
      joinButton?.props.onClick();
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!public:example.org', {
      viaServers: ['resident.example.org'],
    });
  });

  it('does not expose Join while room access discovery is pending', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Loading };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!private:example.org" />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Checking access'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('retries failed room access discovery without attempting to join', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Error,
      error: new Error('Summary unavailable'),
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!private:example.org" />
        </MatrixClientProvider>
      );
    });
    const retryButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Retry room info')).length > 0
      );

    act(() => retryButton?.props.onClick());

    expect(summaryLoaderMock.retry).toHaveBeenCalledOnce();
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('treats an omitted rule in a successful summary as public', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!private:example.org',
        name: 'Incomplete private room',
      },
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!private:example.org" />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', { viaServers: undefined });
  });

  it('allows an invited user to accept an invite-only room deep link', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!invited:example.org',
        name: 'Invited room',
        join_rule: JoinRule.Invite,
        membership: 'invite',
      },
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!invited:example.org" />
        </MatrixClientProvider>
      );
    });
    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(mx.joinRoom).toHaveBeenCalledWith('!invited:example.org', {
      viaServers: undefined,
    });
  });

  it('keeps invite-only rooms blocked without an invitation', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!invite-only:example.org',
        name: 'Invite-only room',
        join_rule: JoinRule.Invite,
        membership: 'leave',
      },
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!invite-only:example.org" />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      0
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });
});
