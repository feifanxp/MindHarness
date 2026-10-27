import React from 'react';
import { JoinRule, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { Membership } from '../../../types/matrix/room';
import type { RoomAccessJoinRule } from '../room-access';
import { RoomCard } from './RoomCard';

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

vi.mock('../room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('./style.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

type MockMatrixClient = Pick<
  MatrixClient,
  'getRoom' | 'getRooms' | 'joinRoom' | 'knockRoom' | 'on' | 'removeListener'
>;

const makeMx = (
  initialMembership?: string,
  localJoinRule?: RoomAccessJoinRule,
  canonicalAlias?: string,
  alternativeAliases: string[] = []
) => {
  let membership = initialMembership;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const room = {
    roomId: '!private:example.org',
    name: 'Cached room',
    getMyMembership: () => membership,
    getJoinRule: () => localJoinRule,
    getCanonicalAlias: () => canonicalAlias ?? null,
    getAltAliases: () => alternativeAliases,
    getMxcAvatarUrl: () => null,
    getJoinedMemberCount: () => 1,
    isSpaceRoom: () => false,
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => null }),
    }),
  } as Room;
  const mx: MockMatrixClient = {
    getRoom: vi.fn((roomId: string) =>
      membership && roomId === '!private:example.org' ? room : null
    ),
    getRooms: vi.fn(() => (membership ? [room] : [])),
    joinRoom: vi.fn(async () => ({} as never)),
    knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return mx as MatrixClient;
    }) as MatrixClient['on'],
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
      return mx as MatrixClient;
    }) as MatrixClient['removeListener'],
  };

  return {
    mx,
    setMembership: (nextMembership: string) => {
      membership = nextMembership;
      listeners.get(RoomEvent.MyMembership)?.forEach((listener) => listener(room, nextMembership));
    },
  };
};

const renderRoomCard = (
  joinRule?: RoomAccessJoinRule,
  membership?: string,
  accessStatus?: AsyncStatus,
  onAccessRetry?: () => void,
  localJoinRule?: RoomAccessJoinRule,
  roomIdOrAlias = '!private:example.org',
  canonicalAlias = roomIdOrAlias.startsWith('#') ? roomIdOrAlias : undefined,
  roomId?: string,
  allRooms: string[] = []
) => {
  const matrix = makeMx(
    membership,
    localJoinRule,
    canonicalAlias,
    roomIdOrAlias.startsWith('#') && canonicalAlias !== roomIdOrAlias ? [roomIdOrAlias] : []
  );
  const { mx } = matrix;
  let renderer: ReactTestRenderer;

  act(() => {
    renderer = create(
      <MatrixClientProvider value={mx as MatrixClient}>
        <RoomCard
          roomIdOrAlias={roomIdOrAlias}
          roomId={roomId}
          allRooms={allRooms}
          name="Private room"
          joinRule={joinRule}
          accessStatus={accessStatus}
          onAccessRetry={onAccessRetry}
          viaServers={['one.example.org', 'two.example.org']}
          renderTopicViewer={() => null}
        />
      </MatrixClientProvider>
    );
  });

  return { renderer: renderer!, mx, setMembership: matrix.setMembership };
};

describe('RoomCard room access', () => {
  it('offers a join request when the room allows knocking', () => {
    const { renderer } = renderRoomCard(JoinRule.Knock);

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('ignores stale public access state from a left room', () => {
    const { renderer, mx } = renderRoomCard(
      JoinRule.Knock,
      Membership.Leave,
      undefined,
      undefined,
      JoinRule.Public
    );

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('offers the same request flow for knock-restricted rooms', () => {
    const { renderer } = renderRoomCard('knock_restricted');

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('preserves direct joining for a confirmed public room', () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Public);
    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: ['one.example.org', 'two.example.org'],
    });
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('keeps a valid invitation when summary discovery fails without an access rule', () => {
    const { renderer } = renderRoomCard(undefined, Membership.Invite, AsyncStatus.Error, vi.fn());

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      0
    );
  });

  it('keeps a cached pending request when summary discovery fails without an access rule', () => {
    const { renderer } = renderRoomCard(undefined, Membership.Knock, AsyncStatus.Error, vi.fn());

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      0
    );
  });

  it("does not trust a cached room's self-claimed alias when discovery fails", () => {
    const { renderer } = renderRoomCard(
      undefined,
      Membership.Invite,
      AsyncStatus.Error,
      vi.fn(),
      JoinRule.Invite,
      '#private:example.org'
    );

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      1
    );
  });

  it('shows View for a joined room resolved from an alternative alias', () => {
    const { mx } = makeMx(Membership.Join, JoinRule.Public, '#canonical:example.org', [
      '#alternative:example.org',
    ]);
    const room = mx.getRoom('!private:example.org') as Room & {
      name: string;
      isSpaceRoom: () => boolean;
      getJoinedMemberCount: () => number;
      getMxcAvatarUrl: () => null;
    };
    room.name = 'Private room';
    room.isSpaceRoom = () => false;
    room.getJoinedMemberCount = () => 1;
    room.getMxcAvatarUrl = () => null;
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx as MatrixClient}>
          <RoomCard
            roomIdOrAlias="#alternative:example.org"
            roomId={room.roomId}
            allRooms={[room.roomId]}
            name="Private room"
            joinRule={JoinRule.Public}
            renderTopicViewer={() => null}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer!.root.findAll((node) => node.children.includes('View'))).toHaveLength(1);
    expect(renderer!.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('does not replace a verified target with a stale joined alias', () => {
    const { renderer } = renderRoomCard(
      JoinRule.Knock,
      Membership.Leave,
      undefined,
      undefined,
      JoinRule.Public,
      '#team:example.org',
      '#team:example.org',
      '!new:example.org',
      ['!private:example.org']
    );

    expect(renderer.root.findAll((node) => node.children.includes('View'))).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
  });

  it('does not infer a joined room from an unresolved self-claimed alias', () => {
    const { renderer } = renderRoomCard(
      undefined,
      Membership.Leave,
      AsyncStatus.Error,
      vi.fn(),
      JoinRule.Public,
      '#team:example.org',
      '#team:example.org',
      undefined,
      ['!private:example.org']
    );

    expect(renderer.root.findAll((node) => node.children.includes('View'))).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      1
    );
  });

  it('does not expose room access while summary discovery is loading', () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Public, undefined, AsyncStatus.Loading);

    expect(renderer.root.findAll((node) => node.children.includes('Checking access'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('offers a safe summary retry without attempting to join', () => {
    const retry = vi.fn();
    const { renderer, mx } = renderRoomCard(JoinRule.Public, undefined, AsyncStatus.Error, retry);
    const retryButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Retry room info')).length > 0
      );

    act(() => retryButton?.props.onClick());

    expect(retry).toHaveBeenCalledOnce();
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('reveals a live invitation while failed discovery is showing retry', () => {
    const { renderer, setMembership } = renderRoomCard(
      undefined,
      Membership.Leave,
      AsyncStatus.Error,
      vi.fn()
    );

    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      1
    );
    act(() => setMembership(Membership.Invite));

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Retry room info'))).toHaveLength(
      0
    );
  });

  it('treats an omitted rule in a successful summary as public', () => {
    const { renderer, mx } = renderRoomCard(undefined, undefined, AsyncStatus.Success);
    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: ['one.example.org', 'two.example.org'],
    });
  });

  it('submits a trimmed request message through the supplied servers and confirms success', async () => {
    const { renderer, mx } = renderRoomCard(JoinRule.Knock);
    const accessButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Request to join')).length > 0
      );

    act(() => accessButton?.props.onClick());
    const form = renderer.root.find((node) => node.type === 'form');

    await act(async () => {
      form.props.onSubmit?.({
        preventDefault: vi.fn(),
        target: {
          reasonInput: { value: '  I work with this team.  ' },
        },
      });
      await Promise.resolve();
    });

    expect(mx.knockRoom).toHaveBeenCalledWith('!private:example.org', {
      reason: 'I work with this team.',
      viaServers: ['one.example.org', 'two.example.org'],
    });
    expect(mx.joinRoom).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.type === 'form')).toHaveLength(0);
  });
});
