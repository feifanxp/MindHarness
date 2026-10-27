// @vitest-environment jsdom

import React from 'react';
import {
  EventType,
  JoinRule,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomState,
} from 'matrix-js-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { Membership } from '../../../types/matrix/room';
import { RoomAccessControl } from './RoomAccessControl';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? children : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
  };
});

const mx = {
  getRoom: vi.fn(() => null),
  getRooms: vi.fn(() => []),
  getUserId: vi.fn(() => '@me:example.org'),
  joinRoom: vi.fn(async () => ({})),
  knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

const getButton = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
};

describe('RoomAccessControl request dialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
    vi.mocked(mx.getRooms).mockReturnValue([]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => <button onClick={access.activate}>Request to join</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not submit when the user cancels', () => {
    act(() => getButton(container, 'Request to join').click());

    act(() => getButton(container, 'Cancel').click());

    expect(mx.knockRoom).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });

  it('exposes a named modal, an associated message label, and announced errors', async () => {
    vi.mocked(mx.knockRoom).mockRejectedValueOnce(new Error('Requests are paused'));
    act(() => getButton(container, 'Request to join').click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.tabIndex).toBe(-1);
    const titleId = dialog?.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toBe('Request to join Private room');

    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    expect(message).not.toBeNull();
    expect(message?.labels?.[0]?.textContent).toBe('Message (optional)');

    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Requests are paused');
  });

  it('moves focus from the trigger into the request dialog', async () => {
    const trigger = getButton(container, 'Request to join');
    trigger.focus();

    act(() => trigger.click());
    await act(async () => {
      await vi.waitFor(() => {
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog?.contains(document.activeElement)).toBe(true);
      });
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('starts a fresh access session when the target room changes', async () => {
    const renderJoin = (roomId: string) => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={roomId}
            roomId={roomId}
            roomName={roomId}
            joinRule={JoinRule.Public}
          >
            {(access) => (
              <button onClick={access.activate}>{access.succeeded ? 'Joined' : 'Join'}</button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    };

    act(() => renderJoin('!first:example.org'));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getButton(container, 'Joined')).toBeDefined();

    act(() => renderJoin('!second:example.org'));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mx.joinRoom).toHaveBeenCalledTimes(2);

    expect(mx.joinRoom).toHaveBeenNthCalledWith(1, '!first:example.org', {
      viaServers: undefined,
    });
    expect(mx.joinRoom).toHaveBeenNthCalledWith(2, '!second:example.org', {
      viaServers: undefined,
    });
  });

  it('restores the sent state from summary knock membership without a cached room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(null);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            membership={Membership.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Request sent').disabled).toBe(true);
  });

  it('invalidates a successful request when summary membership ends the knock', async () => {
    const renderAccess = (membership: Membership) =>
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            membership={membership}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );

    act(() => renderAccess(Membership.Leave));
    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    expect(getButton(container, 'Request sent')).toBeDefined();

    act(() => renderAccess(Membership.Knock));
    expect(getButton(container, 'Request sent')).toBeDefined();

    act(() => renderAccess(Membership.Leave));
    expect(getButton(container, 'Request to join').disabled).toBe(false);
  });

  it('restores the sent state from cached knock membership without an access rule', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => Membership.Knock,
      getJoinRule: () => undefined,
    } as unknown as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            fallback={<button disabled>Access unavailable</button>}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Request sent').disabled).toBe(true);
    expect(container.textContent).not.toContain('Access unavailable');
  });

  it('accepts a valid invitation even when the room supports knocking', async () => {
    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            membership={Membership.Invite}
          >
            {(access) => (
              <button onClick={access.activate}>{access.kind === 'join' ? 'Join' : 'Knock'}</button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: undefined,
    });
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('uses a cached invitation when summary membership is unavailable', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => Membership.Invite,
      getJoinRule: () => JoinRule.Invite,
    } as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl roomIdOrAlias="!private:example.org" roomName="Private room">
            {(access) => <button>{access.kind === 'join' ? 'Join' : 'Knock'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Join')).toBeDefined();
  });

  it("does not trust a cached room's self-claimed alias", () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Invite,
      getCanonicalAlias: () => '#trusted:example.org',
      getAltAliases: () => [],
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: () => null }),
      }),
    } as unknown as Room;
    vi.mocked(mx.getRoom).mockImplementation((roomId) => (roomId === room.roomId ? room : null));
    vi.mocked(mx.getRooms).mockReturnValue([room]);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="#trusted:example.org"
            roomName="Private room"
            fallback={<button>Access unavailable</button>}
          >
            {(access) => <button>{access.kind === 'join' ? 'Join' : 'Request to join'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Access unavailable')).toBeDefined();
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('reveals Join when live membership changes to invite', () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Invite,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(room);
    vi.mocked(mx.on).mockClear();

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={room.roomId}
            roomName="Private room"
            joinRule={JoinRule.Invite}
            fallback={<button>Access unavailable</button>}
          >
            {(access) => <button>{access.kind === 'join' ? 'Join' : 'Knock'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Access unavailable')).toBeDefined();
    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener(room, Membership.Invite, Membership.Leave);
    });

    expect(getButton(container, 'Join')).toBeDefined();
  });

  it('reveals authoritative invite and knock membership without a discovered rule', () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => undefined,
    } as unknown as Room;
    vi.mocked(mx.getRoom).mockReturnValue(room);
    vi.mocked(mx.on).mockClear();

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={room.roomId}
            roomName="Private room"
            fallback={<button>Access unavailable</button>}
          >
            {(access) => (
              <button>
                {access.requested
                  ? 'Request sent'
                  : access.kind === 'knock'
                  ? 'Request to join'
                  : 'Join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Access unavailable')).toBeDefined();
    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => membershipListener(room, Membership.Invite, Membership.Leave));
    expect(getButton(container, 'Join')).toBeDefined();

    act(() => membershipListener(room, Membership.Leave, Membership.Invite));
    expect(getButton(container, 'Access unavailable')).toBeDefined();

    act(() => membershipListener(room, Membership.Knock, Membership.Leave));
    expect(getButton(container, 'Request sent')).toBeDefined();
  });

  it('does not expose access for an already joined room missing from the parent room list', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Join,
    } as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
            fallback={<button>Access unavailable</button>}
          >
            {(access) => (
              <button onClick={access.activate}>
                {access.kind === 'knock' ? 'Request to join' : 'Join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(container.querySelector('button')).toBeNull();
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('closes a knock prompt when live membership becomes joined', () => {
    act(() => getButton(container, 'Request to join').click());
    expect(container.querySelector('form')).not.toBeNull();

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Join);
    });

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button')).toBeNull();

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Leave);
    });

    expect(container.querySelector('form')).toBeNull();
    expect(getButton(container, 'Request to join')).toBeDefined();
  });

  it("does not trust live membership from a room's self-claimed alias", () => {
    const roomAlias = '#trusted:example.org';
    const room = {
      roomId: '!private:example.org',
      getCanonicalAlias: () => roomAlias,
      getAltAliases: () => [],
    } as unknown as Room;
    vi.mocked(mx.getRoom).mockReturnValue(null);
    vi.mocked(mx.on).mockClear();

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={roomAlias}
            roomName="Private room"
            fallback={<button>Access unavailable</button>}
          >
            {(access) => (
              <button>
                {access.requested
                  ? 'Request sent'
                  : access.kind === 'knock'
                  ? 'Request to join'
                  : 'Join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Access unavailable')).toBeDefined();
    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => membershipListener(room, Membership.Invite, Membership.Leave));
    expect(getButton(container, 'Access unavailable')).toBeDefined();

    act(() => membershipListener(room, Membership.Knock, Membership.Leave));
    expect(getButton(container, 'Access unavailable')).toBeDefined();
  });

  it.each([
    {
      baseRule: JoinRule.Public,
      initialMembership: Membership.Invite,
      expectedAction: 'Join',
    },
    {
      baseRule: JoinRule.Knock,
      initialMembership: Membership.Invite,
      expectedAction: 'Request to join',
    },
    {
      baseRule: JoinRule.Public,
      initialMembership: Membership.Knock,
      expectedAction: 'Join',
    },
  ])(
    'restores $baseRule access after transient $initialMembership membership ends',
    ({ baseRule, initialMembership, expectedAction }) => {
      const room = {
        roomId: '!override:example.org',
        getMyMembership: () => initialMembership,
        getJoinRule: () =>
          initialMembership === Membership.Invite ? JoinRule.Invite : JoinRule.Knock,
      } as Room;
      vi.mocked(mx.getRoom).mockReturnValue(room);
      vi.mocked(mx.on).mockClear();

      act(() => {
        root.render(
          <MatrixClientProvider value={mx}>
            <RoomAccessControl
              roomIdOrAlias={room.roomId}
              roomName="Private room"
              joinRule={baseRule}
              fallback={<button>Access unavailable</button>}
            >
              {(access) => (
                <button>
                  {access.requested
                    ? 'Request sent'
                    : access.kind === 'knock'
                    ? 'Request to join'
                    : 'Join'}
                </button>
              )}
            </RoomAccessControl>
          </MatrixClientProvider>
        );
      });

      const membershipListener = vi
        .mocked(mx.on)
        .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
      if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

      act(() => membershipListener(room, Membership.Leave, initialMembership));
      expect(getButton(container, expectedAction)).toBeDefined();
    }
  );

  it.each([JoinRule.Public, JoinRule.Restricted])(
    'allows a knocked user to join after discovery changes the rule to %s',
    async (joinRule) => {
      const renderAccess = (nextRule: JoinRule) =>
        root.render(
          <MatrixClientProvider value={mx}>
            <RoomAccessControl
              roomIdOrAlias="!private:example.org"
              roomName="Private room"
              joinRule={nextRule}
              membership={Membership.Knock}
            >
              {(access) => (
                <button onClick={access.activate}>
                  {access.requested
                    ? 'Request sent'
                    : access.kind === 'knock'
                    ? 'Request to join'
                    : 'Join'}
                </button>
              )}
            </RoomAccessControl>
          </MatrixClientProvider>
        );

      act(() => renderAccess(JoinRule.Knock));
      expect(getButton(container, 'Request sent')).toBeDefined();

      act(() => renderAccess(joinRule));
      await act(async () => {
        getButton(container, 'Join').click();
        await Promise.resolve();
      });

      expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
        viaServers: undefined,
      });
      expect(mx.knockRoom).not.toHaveBeenCalled();
    }
  );

  it('prefers explicit discovery over stale access state from a left room', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Public,
    } as Room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => <button>{access.kind === 'knock' ? 'Request to join' : 'Join'}</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    expect(getButton(container, 'Request to join')).toBeDefined();
  });

  it('invalidates a sent request when a new self-membership event remains leave', async () => {
    const room = {
      roomId: '!private:example.org',
      getMyMembership: () => Membership.Leave,
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(room);

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias={room.roomId}
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    expect(getButton(container, 'Request sent')).toBeDefined();

    const stateListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomStateEvent.Events)?.[1];
    if (typeof stateListener !== 'function') throw new Error('Missing state event listener');

    act(() => {
      stateListener(
        {
          getRoomId: () => room.roomId,
          getType: () => EventType.RoomMember,
          getStateKey: () => '@me:example.org',
          getContent: () => ({ membership: Membership.Leave }),
        } as MatrixEvent,
        { roomId: room.roomId } as RoomState,
        null
      );
    });

    expect(getButton(container, 'Request to join')).toBeDefined();
  });

  it('closes the dialog when sync confirms a request before the endpoint rejects', async () => {
    let rejectRequest: (error: Error) => void = () => undefined;
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        })
    );

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => (
              <button disabled={access.requested} onClick={access.activate}>
                {access.requested ? 'Request sent' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    act(() => getButton(container, 'Request to join').click());
    act(() => container.querySelector('form')?.requestSubmit());

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Knock);
    });
    await act(async () => {
      rejectRequest(new Error('Request timed out'));
      await Promise.resolve();
    });

    expect(container.querySelector('form')).toBeNull();
    expect(getButton(container, 'Request sent')).toBeDefined();
  });

  it('does not dismiss an in-flight request from an outside click', async () => {
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the request in flight while the outside click is exercised.
        })
    );

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('form')).not.toBeNull();
    expect(getButton(container, 'Sending request').disabled).toBe(true);
  });

  it('dismisses an idle request with Escape while the message is focused', () => {
    act(() => getButton(container, 'Request to join').click());
    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    if (!message) throw new Error('Missing request message');
    act(() => message.focus());
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      )
    );

    expect(container.querySelector('form')).toBeNull();
  });

  it('does not dismiss an in-flight request with Escape', async () => {
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the request in flight while Escape is exercised.
        })
    );

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });
    act(() => container.querySelector<HTMLElement>('[role="dialog"]')?.focus());
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      )
    );

    expect(container.querySelector('form')).not.toBeNull();
    expect(getButton(container, 'Sending request').disabled).toBe(true);
  });

  it('makes a request actionable when rejection sync beats a pending endpoint', async () => {
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the endpoint pending while sync rejects the request.
        })
    );

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');
    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Leave);
    });

    expect(getButton(container, 'Send request').disabled).toBe(false);
    expect(getButton(container, 'Cancel').disabled).toBe(false);
  });

  it('keeps retry input open when a rejected request endpoint resolves late', async () => {
    let resolveRequest: () => void = () => undefined;
    vi.mocked(mx.knockRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => {
            resolve({ room_id: '!private:example.org' });
          };
        })
    );

    act(() => getButton(container, 'Request to join').click());
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');
    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Leave);
    });

    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    if (!message) throw new Error('Missing request message');
    message.value = 'Replacement message';
    await act(async () => {
      resolveRequest();
      await Promise.resolve();
    });

    expect(container.querySelector('form')).not.toBeNull();
    expect(message.value).toBe('Replacement message');
  });

  it('keeps repeated invites pending but allows a renewed invite after revocation', async () => {
    let resolveFirstJoin = () => undefined;
    vi.mocked(mx.joinRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstJoin = () => {
            resolve({} as Room);
          };
        })
    );

    const renderAccess = () =>
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => (
              <button disabled={access.loading} onClick={access.activate}>
                {access.loading ? 'Joining' : access.kind === 'join' ? 'Join' : 'Request to join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );

    act(renderAccess);

    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');
    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Invite);
    });
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(getButton(container, 'Joining').disabled).toBe(true);

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Invite);
    });
    act(renderAccess);

    expect(getButton(container, 'Joining').disabled).toBe(true);
    expect(mx.joinRoom).toHaveBeenCalledOnce();

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Leave);
    });
    expect(getButton(container, 'Request to join').disabled).toBe(false);

    act(() => {
      membershipListener({ roomId: '!private:example.org' } as Room, Membership.Invite);
    });
    expect(getButton(container, 'Join').disabled).toBe(false);

    await act(async () => {
      resolveFirstJoin();
      await Promise.resolve();
    });

    expect(getButton(container, 'Join').disabled).toBe(false);
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mx.joinRoom).toHaveBeenCalledTimes(2);
  });

  it('ignores a deferred join result after live membership joins and then leaves', async () => {
    let resolveJoin = () => undefined;
    vi.mocked(mx.joinRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveJoin = () => resolve({} as Room);
        })
    );
    vi.mocked(mx.on).mockClear();

    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!public:example.org"
            roomName="Public room"
            joinRule={JoinRule.Public}
          >
            {(access) => (
              <button disabled={access.loading || access.succeeded} onClick={access.activate}>
                {access.loading || access.succeeded ? 'Joining' : 'Join'}
              </button>
            )}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    });

    await act(async () => {
      getButton(container, 'Join').click();
      await Promise.resolve();
    });
    expect(getButton(container, 'Joining').disabled).toBe(true);
    const membershipListener = vi
      .mocked(mx.on)
      .mock.calls.find(([event]) => event === RoomEvent.MyMembership)?.[1];
    if (typeof membershipListener !== 'function') throw new Error('Missing membership listener');

    act(() => {
      membershipListener({ roomId: '!public:example.org' } as Room, Membership.Join);
      membershipListener({ roomId: '!public:example.org' } as Room, Membership.Leave);
    });
    await act(async () => {
      resolveJoin();
      await Promise.resolve();
    });

    expect(getButton(container, 'Join').disabled).toBe(false);
  });

  it('fails closed for missing or unverified access rules', async () => {
    const renderJoin = (joinRule?: JoinRule, membership?: Membership) => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={joinRule}
            membership={membership}
          >
            {(access) => <button onClick={access.activate}>Join</button>}
          </RoomAccessControl>
        </MatrixClientProvider>
      );
    };

    act(() => renderJoin());
    expect(container.querySelector('button')).toBeNull();

    act(() => renderJoin(JoinRule.Invite));
    expect(container.querySelector('button')).toBeNull();

    act(() => renderJoin(JoinRule.Public, Membership.Ban));
    expect(container.querySelector('button')).toBeNull();

    act(() => renderJoin(JoinRule.Invite, Membership.Invite));
    act(() => getButton(container, 'Join').click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mx.joinRoom).toHaveBeenCalledWith('!private:example.org', {
      viaServers: undefined,
    });
  });
});
