import React from 'react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { RoomItemCard } from './RoomItem';

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
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/sequence-card', () => ({
  SequenceCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
  RoomIcon: () => React.createElement('i'),
}));

vi.mock('../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../utils/room', async () => {
  const actual = await vi.importActual<typeof import('../../utils/room')>('../../utils/room');
  return {
    ...actual,
    getRoomAvatarUrl: () => undefined,
  };
});

vi.mock('./DnD', () => ({
  ItemDraggableTarget: () => null,
  useDraggableItem: () => undefined,
}));

vi.mock('./RoomItem.css', () => ({
  ErrorNameContainer: 'ErrorNameContainer',
  RoomItemCard: 'RoomItemCard',
  RoomProfileTopic: 'RoomProfileTopic',
}));

vi.mock('./style.css', () => ({
  AvatarPlaceholder: 'AvatarPlaceholder',
  LinePlaceholder: 'LinePlaceholder',
}));

const roomId = '!private:example.org';
const item: HierarchyItem = {
  roomId,
  parentId: '!space:example.org',
  content: { via: ['one.example.org'] },
  ts: 1,
};
const summary: IHierarchyRoom = {
  room_id: roomId,
  name: 'Private room',
  topic: 'Private discussion',
  canonical_alias: '#private:example.org',
  avatar_url: undefined,
  world_readable: false,
  guest_can_join: false,
  num_joined_members: 12,
  room_type: undefined,
  join_rule: JoinRule.Knock,
  children_state: [],
};
const mx = {
  getRoom: vi.fn(() => null),
  joinRoom: vi.fn(),
  knockRoom: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

const cachedRoom = (membership: string, joinRule: JoinRule): Room =>
  ({
    roomId,
    name: 'Private room',
    getMyMembership: () => membership,
    getJoinRule: () => joinRule,
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => undefined }),
    }),
    getGuestAccess: () => 'forbidden',
    getMxcAvatarUrl: () => null,
    getCanonicalAlias: () => null,
    getJoinedMemberCount: () => 12,
    getType: () => undefined,
  } as Room);

describe('RoomItemCard room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
  });

  it('offers a join request for a knock-capable child room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('leave', JoinRule.Invite));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={null}
            summary={summary}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('does not assume public access when child-room discovery fails', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={new Error('Summary unavailable')}
            summary={undefined}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('treats an omitted child-room hierarchy rule as public', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={null}
            summary={{ ...summary, join_rule: undefined }}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
  });

  it('does not assume public access when a child-room summary has an unknown rule', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={null}
            summary={{ ...summary, join_rule: 'custom_access' as JoinRule }}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('keeps a cached invitation joinable when child-room discovery fails', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('invite', JoinRule.Invite));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={new Error('Summary unavailable')}
            summary={undefined}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(0);
  });

  it('uses a refreshed hierarchy rule for a cached knocked room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('knock', JoinRule.Knock));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            error={null}
            summary={{ ...summary, join_rule: JoinRule.Public }}
            onOpen={vi.fn()}
            onDragging={vi.fn()}
            canReorder={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });
});
