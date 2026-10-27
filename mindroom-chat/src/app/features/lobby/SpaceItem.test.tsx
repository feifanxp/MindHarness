import React from 'react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Membership } from '../../../types/matrix/room';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import type { LocalRoomSummary } from '../../hooks/useLocalRoomSummary';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { SpaceItemCard } from './SpaceItem';

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

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../components/RoomSummaryLoader', () => ({
  LocalRoomSummaryLoader: ({
    room,
    children,
  }: {
    room: Room;
    children: (summary: LocalRoomSummary) => React.ReactNode;
  }) =>
    children({
      roomId,
      name: 'Private space',
      topic: 'Private projects',
      avatarUrl: undefined,
      canonicalAlias: '#private-space:example.org',
      worldReadable: false,
      guestCanJoin: false,
      memberCount: 12,
      roomType: 'm.space',
      joinRule: room.getJoinRule?.() ?? JoinRule.Knock,
    }),
}));

vi.mock('../../utils/room', async () => {
  const actual = await vi.importActual<typeof import('../../utils/room')>('../../utils/room');
  return {
    ...actual,
    getRoomAvatarUrl: () => undefined,
  };
});

vi.mock('./DnD', () => ({
  useDraggableItem: () => undefined,
}));

vi.mock('../add-existing', () => ({
  AddExistingModal: () => null,
}));

vi.mock('../../state/hooks/createRoomModal', () => ({
  useOpenCreateRoomModal: () => vi.fn(),
}));

vi.mock('../../state/hooks/createSpaceModal', () => ({
  useOpenCreateSpaceModal: () => vi.fn(),
}));

vi.mock('../../components/BetaNoticeBadge', () => ({
  BetaNoticeBadge: () => null,
}));

vi.mock('./SpaceItem.css', () => ({
  HeaderChip: 'HeaderChip',
  HeaderChipPlaceholder: 'HeaderChipPlaceholder',
  SpaceItemCard: () => 'SpaceItemCard',
}));

vi.mock('./style.css', () => ({
  AvatarPlaceholder: 'AvatarPlaceholder',
  LinePlaceholder: 'LinePlaceholder',
}));

const roomId = '!private-space:example.org';
const item: HierarchyItem = {
  roomId,
  parentId: '!root-space:example.org',
  content: { via: ['one.example.org'] },
  ts: 1,
  space: true,
};
const summary: IHierarchyRoom = {
  room_id: roomId,
  name: 'Private space',
  topic: 'Private projects',
  canonical_alias: '#private-space:example.org',
  avatar_url: undefined,
  world_readable: false,
  guest_can_join: false,
  num_joined_members: 12,
  room_type: 'm.space',
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

describe('SpaceItemCard room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
  });

  it('offers a join request for a knock-capable child space', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => 'leave',
      getJoinRule: () => JoinRule.Invite,
    } as Room);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('keeps a synced knocked space in the pending-request state', () => {
    const knockedSpace = {
      roomId,
      getMyMembership: () => 'knock',
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(knockedSpace);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => knockedSpace}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      0
    );
  });

  it('keeps an exactly joined cached space visible while the joined list catches up', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId,
      getMyMembership: () => Membership.Join,
      getJoinRule: () => JoinRule.Public,
    } as Room);
    const renderer = create(<></>);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAllByProps({ className: 'HeaderChip' })).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Private space'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      0
    );
  });

  it('starts a fresh request state when a virtualized row is reused for another space', async () => {
    vi.mocked(mx.knockRoom).mockResolvedValue({ room_id: roomId });
    const renderer = create(<></>);
    const renderCard = (nextItem: HierarchyItem, nextSummary: IHierarchyRoom) => (
      <MatrixClientProvider value={mx}>
        <SpaceItemCard
          item={nextItem}
          summary={nextSummary}
          joined={false}
          categoryId={nextItem.roomId}
          closed={false}
          canEditChild={false}
          canReorder={false}
          onDragging={vi.fn()}
          getRoom={() => undefined}
        />
      </MatrixClientProvider>
    );

    act(() => renderer.update(renderCard(item, summary)));
    act(() => {
      renderer.root.findByProps({ className: 'HeaderChip' }).props.onClick();
    });
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);

    const nextRoomId = '!another-private-space:example.org';
    act(() => {
      renderer.update(
        renderCard(
          { ...item, roomId: nextRoomId },
          { ...summary, room_id: nextRoomId, name: 'Another private space' }
        )
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('treats an omitted child-space hierarchy rule as public', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: undefined }}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root.findAll(
      (node) => node.props.className === 'HeaderChip' && typeof node.props.onClick === 'function'
    )[0];

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
  });

  it('does not assume public access when a child-space summary has an unknown rule', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: 'custom_access' as JoinRule }}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
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

  it('keeps a cached invitation joinable when child-space discovery is unavailable', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => 'invite',
      getJoinRule: () => JoinRule.Invite,
    } as Room);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            loading={false}
            summary={undefined}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll(
        (node) =>
          node.props.className === 'HeaderChip' &&
          typeof node.props.onClick === 'function' &&
          node.props.disabled === false
      )
    ).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(0);
  });

  it('uses a refreshed hierarchy rule for a cached knocked space', () => {
    const knockedSpace = {
      roomId,
      getMyMembership: () => Membership.Knock,
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(knockedSpace);
    const renderer = create(<></>);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: JoinRule.Public }}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root.findAll(
      (node) =>
        node.props.className === 'HeaderChip' &&
        typeof node.props.onClick === 'function' &&
        node.props.disabled === false
    )[0];

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });
});
