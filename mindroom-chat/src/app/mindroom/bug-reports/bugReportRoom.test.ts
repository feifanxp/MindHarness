import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureBugReportRoom } from './bugReportRoom';

const ME = '@alice:example.com';

type Memberships = Record<string, string>;

/**
 * A room whose member map starts with `members` and gains `lazyMembers` once
 * `loadMembersIfNeeded` resolves, like a lazy-loading sync.
 */
const room = (
  roomId: string,
  myMembership: string,
  opts: {
    members?: Memberships;
    lazyMembers?: Memberships;
    joinRule?: string;
    historyVisibility?: string;
    /** The create event's `type`; `null` leaves the room untyped. */
    type?: string | null;
  } = {}
) => {
  const members: Memberships = { [ME]: myMembership, ...opts.members };
  return {
    roomId,
    getMyMembership: () => myMembership,
    getType: () => (opts.type === null ? undefined : opts.type ?? 'io.mindroom.bug_reports'),
    getJoinRule: () => opts.joinRule ?? 'invite',
    getHistoryVisibility: () => opts.historyVisibility ?? 'shared',
    loadMembersIfNeeded: vi.fn(async () => {
      Object.assign(members, opts.lazyMembers);
      return true;
    }),
    getMember: (userId: string) =>
      members[userId] ? { userId, membership: members[userId] } : null,
    getMembers: () =>
      Object.entries(members).map(([userId, membership]) => ({ userId, membership })),
  };
};

const client = (
  opts: {
    storedRoomId?: string;
    rooms?: Record<string, ReturnType<typeof room>>;
    /** Invites the homeserver drops while creating the room (Tuwunel logs and ignores them). */
    droppedCreateInvites?: string[];
    rejectInvitesTo?: string[];
  } = {}
) => {
  const rooms = { ...opts.rooms };
  const mx = {
    getSafeUserId: () => ME,
    getUser: () => ({ displayName: 'Alice' }),
    getAccountData: vi.fn(() =>
      opts.storedRoomId ? { getContent: () => ({ room_id: opts.storedRoomId }) } : undefined
    ),
    setAccountData: vi.fn(async () => ({})),
    getRoom: vi.fn((roomId: string) => rooms[roomId] ?? null),
    invite: vi.fn(async (_roomId: string, userId: string) => {
      if (opts.rejectInvitesTo?.includes(userId)) throw new Error(`cannot invite ${userId}`);
      return {};
    }),
    kick: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})),
    createRoom: vi.fn(async (request: { invite?: string[] }) => {
      const invited = (request.invite ?? []).filter(
        (userId) => !opts.droppedCreateInvites?.includes(userId)
      );
      rooms['!new:example.com'] = room('!new:example.com', 'join', {
        members: Object.fromEntries(invited.map((userId) => [userId, 'invite'])),
      });
      return { room_id: '!new:example.com' };
    }),
  };
  return mx;
};

const expectNewRoomReplacingStored = (
  mx: ReturnType<typeof client>,
  result: { roomId: string }
) => {
  expect(result.roomId).toBe('!new:example.com');
  expect(mx.createRoom).toHaveBeenCalledTimes(1);
  expect(mx.setAccountData).toHaveBeenCalledWith('io.mindroom.bug_reports', {
    room_id: '!new:example.com',
  });
  expect(mx.kick).not.toHaveBeenCalled();
  expect(mx.leave).not.toHaveBeenCalled();
};

describe('ensureBugReportRoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses the stored room and invites only admins who are not already there', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join', '@ops:example.com': 'leave' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@ops:example.com',
    ]);
    expect(result).toBe(stored);
    expect(mx.createRoom).not.toHaveBeenCalled();
    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.invite).toHaveBeenCalledWith('!stored:example.com', '@ops:example.com');
  });

  it('creates a private, typed, unencrypted room when the stored room was left', async () => {
    const mx = client({
      storedRoomId: '!old:example.com',
      rooms: { '!old:example.com': room('!old:example.com', 'leave') },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com', ME]);
    expect(result.roomId).toBe('!new:example.com');
    const request = mx.createRoom.mock.calls[0][0] as Record<string, unknown>;
    expect(request).toMatchObject({
      name: 'Bug reports · Alice',
      preset: 'private_chat',
      visibility: 'private',
      invite: ['@admin:example.com'],
      creation_content: { type: 'io.mindroom.bug_reports' },
    });
    expect(JSON.stringify(request)).not.toContain('m.room.encryption');
    expect(mx.setAccountData).toHaveBeenCalledWith('io.mindroom.bug_reports', {
      room_id: '!new:example.com',
    });
    expect(mx.invite).not.toHaveBeenCalled();
  });

  it('shares one in-flight lookup so concurrent reports create one room', async () => {
    const mx = client();
    const [first, second] = await Promise.all([
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
    ]);
    expect(first).toBe(second);
    expect(mx.createRoom).toHaveBeenCalledTimes(1);
  });

  it('moves to a new room when a former admin is still in the stored room', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@former:example.com': 'join', '@admin:example.com': 'join' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expectNewRoomReplacingStored(mx, result);
    expect(mx.createRoom.mock.calls[0][0]).toMatchObject({ invite: ['@admin:example.com'] });
  });

  it('moves to a new room when someone other than an admin was invited to the stored room', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join', '@bob:example.com': 'invite' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expectNewRoomReplacingStored(mx, result);
  });

  it('moves to a new room when the stored room is no longer invite-only', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join' },
      joinRule: 'public',
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expectNewRoomReplacingStored(mx, result);
  });

  it.each([
    ['another type', 'm.space'],
    ['no type', null],
  ])(
    'moves to a new room when the stored room has %s instead of the report room type',
    async (_label, type) => {
      const stored = room('!stored:example.com', 'join', {
        members: { '@admin:example.com': 'join' },
        type,
      });
      const mx = client({
        storedRoomId: '!stored:example.com',
        rooms: { '!stored:example.com': stored },
      });
      const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
      expectNewRoomReplacingStored(mx, result);
    }
  );

  it('moves to a new room when the stored room history became world-readable', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join' },
      historyVisibility: 'world_readable',
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expectNewRoomReplacingStored(mx, result);
  });

  it('loads lazy members before deciding, so a joined admin is not invited again', async () => {
    const stored = room('!stored:example.com', 'join', {
      lazyMembers: { '@admin:example.com': 'join' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expect(result).toBe(stored);
    expect(stored.loadMembersIfNeeded).toHaveBeenCalled();
    expect(mx.invite).not.toHaveBeenCalled();
    expect(mx.createRoom).not.toHaveBeenCalled();
  });

  it('loads lazy members before deciding, so a lazily loaded former admin forces a new room', async () => {
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join' },
      lazyMembers: { '@former:example.com': 'join' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, ['@admin:example.com']);
    expectNewRoomReplacingStored(mx, result);
  });

  it('still returns the stored room when one admin cannot be invited but another is joined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stored = room('!stored:example.com', 'join', {
      members: { '@admin:example.com': 'join' },
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
      rejectInvitesTo: ['@gone:example.com'],
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@gone:example.com',
    ]);
    expect(result).toBe(stored);
    expect(mx.invite).toHaveBeenCalledWith('!stored:example.com', '@gone:example.com');
    expect(warn).toHaveBeenCalledWith(
      '[bug-report] could not invite a report admin',
      '@gone:example.com',
      expect.any(Error)
    );
  });

  it('rejects when no admin is in the room and every invite fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stored = room('!stored:example.com', 'join');
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
      rejectInvitesTo: ['@admin:example.com', '@ops:example.com'],
    });
    await expect(
      ensureBugReportRoom(mx as never, ['@admin:example.com', '@ops:example.com'])
    ).rejects.toThrow();
    expect(mx.invite).toHaveBeenCalledTimes(2);
  });

  it('invites an admin again when room creation dropped their invite', async () => {
    const mx = client({ droppedCreateInvites: ['@ops:example.com'] });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@ops:example.com',
    ]);
    expect(result.roomId).toBe('!new:example.com');
    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.invite).toHaveBeenCalledWith('!new:example.com', '@ops:example.com');
  });

  it('gives a reporter who is the only admin a room without invites', async () => {
    const mx = client();
    const result = await ensureBugReportRoom(mx as never, [ME]);
    expect(result.roomId).toBe('!new:example.com');
    expect(mx.createRoom.mock.calls[0][0]).toMatchObject({ invite: [] });
    expect(mx.invite).not.toHaveBeenCalled();
  });
});
