import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import {
  BugReportAutoJoinFeature,
  shouldAutoJoinBugReportInvite,
} from './BugReportAutoJoinFeature';

const mx = (userId = '@admin:example.com') => ({ getUserId: () => userId });

/**
 * `type: null` leaves the invite without an m.room.create event and `joinRule: null`
 * without an m.room.join_rules event, like stripped invite state that omits them.
 */
const invitedRoom = (
  opts: {
    type?: string | null;
    creator?: string;
    joinRule?: string | null;
    inviter?: string;
    membership?: string;
  } = {}
) => {
  const inviter = opts.inviter ?? '@alice:example.com';
  const stateEvents: Record<string, unknown> = {
    'm.room.create':
      opts.type === null
        ? null
        : {
            getContent: () => ({ type: opts.type ?? 'io.mindroom.bug_reports' }),
            getSender: () => opts.creator ?? inviter,
          },
    'm.room.join_rules':
      opts.joinRule === null
        ? null
        : { getContent: () => ({ join_rule: opts.joinRule ?? 'invite' }) },
  };
  return {
    getMyMembership: () => opts.membership ?? 'invite',
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: (eventType: string) => stateEvents[eventType] ?? null }),
    }),
    getMember: () => ({ events: { member: { getSender: () => inviter } } }),
  };
};

const admins = ['@admin:example.com'];

describe('shouldAutoJoinBugReportInvite', () => {
  it('joins report rooms from reporters on the same homeserver', () => {
    expect(shouldAutoJoinBugReportInvite(mx() as never, invitedRoom() as never, admins)).toBe(true);
  });

  it('ignores users who are not configured admins', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx('@bob:example.com') as never, invitedRoom() as never, admins)
    ).toBe(false);
  });

  it('ignores other room types', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ type: 'm.space' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores invites without a create event', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx() as never, invitedRoom({ type: null }) as never, admins)
    ).toBe(false);
  });

  it('ignores inviters from other homeservers', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ inviter: '@mallory:evil.example' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores rooms that are not invite-only', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ joinRule: 'public' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores invites without a join rule', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx() as never, invitedRoom({ joinRule: null }) as never, admins)
    ).toBe(false);
  });

  it('ignores rooms created by someone other than the inviter', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ creator: '@carol:example.com', inviter: '@alice:example.com' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores rooms that are not pending invites', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ membership: 'join' }) as never,
        admins
      )
    ).toBe(false);
    expect(shouldAutoJoinBugReportInvite(mx() as never, null, admins)).toBe(false);
  });
});

describe('BugReportAutoJoinFeature', () => {
  it('tries each report invite once across invite list updates and keeps a failed one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rooms: Record<string, ReturnType<typeof invitedRoom>> = {
      '!ok:example.com': invitedRoom(),
      '!fails:example.com': invitedRoom(),
      '!space:example.com': invitedRoom({ type: 'm.space' }),
    };
    const client = {
      ...mx(),
      getRoom: (roomId: string) => rooms[roomId] ?? null,
      joinRoom: vi.fn(async (roomId: string) => {
        if (roomId === '!fails:example.com') throw new Error('M_FORBIDDEN');
        return {};
      }),
    };
    const store = createStore();
    store.set(allInvitesAtom, {
      type: 'INITIALIZE',
      rooms: ['!ok:example.com', '!fails:example.com'],
    });
    const discovery = {
      'm.homeserver': { base_url: 'https://example.com' },
      'io.mindroom.bug_reports': { admins },
    };

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={client as never}>
          <AutoDiscoveryInfoProvider value={discovery}>
            <Provider store={store}>
              <BugReportAutoJoinFeature />
            </Provider>
          </AutoDiscoveryInfoProvider>
        </MatrixClientProvider>
      );
    });
    await act(async () => store.set(allInvitesAtom, { type: 'DELETE', roomId: '!ok:example.com' }));
    await act(async () => store.set(allInvitesAtom, { type: 'PUT', roomId: '!space:example.com' }));

    expect(client.joinRoom.mock.calls).toEqual([['!ok:example.com'], ['!fails:example.com']]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[bug-report] could not auto-join report room',
      '!fails:example.com',
      expect.any(Error)
    );
    act(() => renderer.unmount());
  });
});
