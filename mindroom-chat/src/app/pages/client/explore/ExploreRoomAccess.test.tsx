// @vitest-environment jsdom

import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { FeaturedRooms } from './Featured';
import { PublicRooms } from './Server';

const mocks = vi.hoisted(() => ({
  roomCardProps: [] as Array<Record<string, unknown>>,
  failFeaturedSummary: false,
  publicRooms: {
    chunk: [
      {
        room_id: '!server-room:example.org',
        canonical_alias: '#server-room:example.org' as string | undefined,
        name: 'Server room',
        topic: 'Server discussion',
        num_joined_members: 12,
        world_readable: false,
        guest_can_join: false,
        join_rule: 'knock' as JoinRule | undefined,
      },
    ],
    total_room_count_estimate: 1,
  },
}));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  return {
    ...actual,
    Overlay: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
      open ? children : null,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.publicRooms, isLoading: false, error: null }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ server: 'example.org' }),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return { ...actual, useAtomValue: () => [] };
});

vi.mock('../../../components/page', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Page: Wrapper,
    PageScroll: ({
      header,
      children,
    }: {
      header?: React.ReactNode;
      children?: React.ReactNode;
    }) => (
      <>
        {header}
        {children}
      </>
    ),
    PageContent: Wrapper,
    PageContentCenter: Wrapper,
    PageHeader: Wrapper,
    PageHeroSection: Wrapper,
    PageHero: () => null,
  };
});

vi.mock('../../../components/room-card', async () => {
  const { RoomAccessControl } = await vi.importActual<
    typeof import('../../../components/room-access')
  >('../../../components/room-access');
  const Wrapper = ({ children }: { children?: React.ReactNode }) => children;
  return {
    RoomCardGrid: Wrapper,
    RoomCardBase: () => null,
    RoomCard: ({ roomIdOrAlias, ...props }: Record<string, unknown>) => {
      mocks.roomCardProps.push({ roomIdOrAlias, ...props });
      return (
        <RoomAccessControl
          roomIdOrAlias={roomIdOrAlias as string}
          roomId={props.roomId as string | undefined}
          roomName={(props.name as string | undefined) ?? (roomIdOrAlias as string)}
          joinRule={props.joinRule as JoinRule | undefined}
          viaServers={props.viaServers as string[] | undefined}
        >
          {(access) => (
            <button onClick={access.activate}>
              {access.kind === 'knock' ? 'Request to join' : 'Join'}
            </button>
          )}
        </RoomAccessControl>
      );
    },
  };
});

vi.mock('../../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../../components/RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    roomIdOrAlias,
    children,
  }: {
    roomIdOrAlias: string;
    children: (
      state: unknown,
      retry: () => void,
      viaServers?: string[],
      roomId?: string
    ) => React.ReactNode;
  }) =>
    children(
      mocks.failFeaturedSummary
        ? { status: AsyncStatus.Error, error: new Error('Summary unavailable') }
        : {
            status: AsyncStatus.Success,
            data: {
              room_id: roomIdOrAlias.includes('featured-space')
                ? '!featured-space:example.org'
                : '!featured-room:example.org',
              name: roomIdOrAlias,
              topic: 'Featured discussion',
              num_joined_members: 5,
              join_rule: roomIdOrAlias.includes('featured-space')
                ? JoinRule.Public
                : JoinRule.Knock,
            },
          },
      vi.fn(),
      ['resident.example.org'],
      roomIdOrAlias.includes('featured-space')
        ? '!featured-space:example.org'
        : '!featured-room:example.org'
    ),
}));

vi.mock('../../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({
    featuredCommunities: {
      spaces: ['#featured-space:example.org'],
      rooms: ['#featured-room:example.org'],
    },
  }),
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: vi.fn(), navigateSpace: vi.fn() }),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../../mindroom/native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    children(vi.fn()),
}));

vi.mock('./style.css', () => ({
  PublicRoomsError: 'PublicRoomsError',
  RoomsInfoCard: 'RoomsInfoCard',
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

describe('Explore room access wiring', () => {
  const makeMx = (): MatrixClient => {
    const mx = {
      getRoom: vi.fn(() => null),
      getUserId: vi.fn(() => null),
      joinRoom: vi.fn(async () => ({})),
      knockRoom: vi.fn(async () => ({ room_id: '!server-room:example.org' })),
      on: vi.fn(),
      removeListener: vi.fn(),
      http: { authedRequest: vi.fn() },
    } as unknown as MatrixClient;
    return mx;
  };

  beforeEach(() => {
    mocks.roomCardProps.length = 0;
    mocks.failFeaturedSummary = false;
    mocks.publicRooms.chunk[0].canonical_alias = '#server-room:example.org';
    mocks.publicRooms.chunk[0].join_rule = JoinRule.Knock;
  });

  it('keeps a verified Featured alias target when its summary fails', () => {
    mocks.failFeaturedSummary = true;
    const mx = makeMx();

    act(() => {
      create(
        <MatrixClientProvider value={mx}>
          <FeaturedRooms />
        </MatrixClientProvider>
      );
    });

    expect(mocks.roomCardProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomIdOrAlias: '#featured-room:example.org',
          roomId: '!featured-room:example.org',
          accessStatus: AsyncStatus.Error,
          viaServers: ['resident.example.org'],
        }),
      ])
    );
  });

  it('routes Featured alias joins and knocks through resolved rooms and servers', async () => {
    const mx = makeMx();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <FeaturedRooms />
        </MatrixClientProvider>
      );
    });

    expect(mocks.roomCardProps).toHaveLength(2);
    expect(mocks.roomCardProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomIdOrAlias: '#featured-space:example.org',
          roomId: '!featured-space:example.org',
          joinRule: JoinRule.Public,
          accessStatus: AsyncStatus.Success,
          viaServers: ['resident.example.org'],
        }),
        expect.objectContaining({
          roomIdOrAlias: '#featured-room:example.org',
          roomId: '!featured-room:example.org',
          joinRule: JoinRule.Knock,
          accessStatus: AsyncStatus.Success,
          viaServers: ['resident.example.org'],
        }),
      ])
    );
    const joinButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    await act(async () => {
      joinButton?.props.onClick();
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!featured-space:example.org', {
      viaServers: ['resident.example.org'],
    });
    const knockButton = renderer!.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => knockButton?.props.onClick());
    const form = renderer!.root.find((node) => node.type === 'form');
    await act(async () => {
      form.props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });

    expect(mx.knockRoom).toHaveBeenCalledWith('!featured-room:example.org', {
      reason: undefined,
      viaServers: ['resident.example.org'],
    });
  });

  it('passes knock rules from server Explore results into room cards', () => {
    const mx = makeMx();

    act(() => {
      create(
        <MatrixClientProvider value={mx}>
          <PublicRooms />
        </MatrixClientProvider>
      );
    });

    expect(mocks.roomCardProps).toHaveLength(1);
    expect(mocks.roomCardProps[0]).toEqual(
      expect.objectContaining({
        roomIdOrAlias: '#server-room:example.org',
        roomId: '!server-room:example.org',
        joinRule: JoinRule.Knock,
      })
    );
  });

  it('keeps legacy public-directory rooms joinable when their rule is omitted', () => {
    mocks.publicRooms.chunk[0].join_rule = undefined;
    const mx = makeMx();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <PublicRooms />
        </MatrixClientProvider>
      );
    });
    const joinButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(mocks.roomCardProps[0]).toEqual(expect.objectContaining({ joinRule: JoinRule.Public }));
    expect(mx.joinRoom).toHaveBeenCalledWith('!server-room:example.org', {
      viaServers: ['example.org'],
    });
  });

  it('uses the explored server to route an aliasless remote knock', () => {
    mocks.publicRooms.chunk[0].canonical_alias = undefined;
    const mx = makeMx();

    act(() => {
      create(
        <MatrixClientProvider value={mx}>
          <PublicRooms />
        </MatrixClientProvider>
      );
    });

    expect(mocks.roomCardProps[0]).toEqual(
      expect.objectContaining({
        roomIdOrAlias: '!server-room:example.org',
        joinRule: JoinRule.Knock,
        viaServers: ['example.org'],
      })
    );
  });
});
