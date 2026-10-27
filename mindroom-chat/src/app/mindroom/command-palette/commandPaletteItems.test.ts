import type { Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCommandPaletteDmRoomMap,
  COMMAND_PALETTE_USER_LIMIT,
  COMMAND_PALETTE_USER_ROOM_LIMIT,
  collectCommandPaletteUserCandidates,
  getCommandPaletteDmUserDetails,
} from './commandPaletteUserCandidates';

const makeRoom = (roomId: string, userIds: string[], space = false) =>
  ({
    roomId,
    isSpaceRoom: () => space,
    getJoinedMembers: vi.fn(() =>
      userIds.map((userId) => ({ userId, rawDisplayName: `Name ${userId}` }))
    ),
  } as unknown as Room);

describe('collectCommandPaletteUserCandidates', () => {
  it('prioritizes the selected room and direct users while deduplicating self', () => {
    const selected = makeRoom('!selected:example.org', [
      '@me:example.org',
      '@direct:example.org',
      '@selected:example.org',
    ]);
    const other = makeRoom('!other:example.org', ['@other:example.org']);
    const rooms = new Map([
      [selected.roomId, selected],
      [other.roomId, other],
    ]);

    const result = collectCommandPaletteUserCandidates({
      directUsers: ['@direct:example.org'],
      getRoom: (roomId) => rooms.get(roomId),
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: [other.roomId, selected.roomId],
      selectedRoomId: selected.roomId,
    });

    expect(result.candidates.map((candidate) => candidate.userId)).toEqual([
      '@direct:example.org',
      '@selected:example.org',
      '@other:example.org',
    ]);
    expect(result.currentRoomMemberIds).toEqual(
      new Set(['@me:example.org', '@direct:example.org', '@selected:example.org'])
    );
  });

  it('caps both room walks and the total candidate set', () => {
    const rooms = Array.from({ length: COMMAND_PALETTE_USER_ROOM_LIMIT + 5 }, (_, index) =>
      makeRoom(`!room-${index}:example.org`, [`@room-${index}:example.org`])
    );
    const largeRoom = makeRoom(
      '!large:example.org',
      Array.from(
        { length: COMMAND_PALETTE_USER_LIMIT + 20 },
        (_, index) => `@large-${index}:example.org`
      )
    );
    const roomMap = new Map([...rooms, largeRoom].map((room) => [room.roomId, room]));

    const roomCapped = collectCommandPaletteUserCandidates({
      directUsers: [],
      getRoom: (roomId) => roomMap.get(roomId),
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: rooms.map((room) => room.roomId),
    });
    expect(roomCapped.candidates).toHaveLength(COMMAND_PALETTE_USER_ROOM_LIMIT);
    expect(rooms[COMMAND_PALETTE_USER_ROOM_LIMIT].getJoinedMembers).not.toHaveBeenCalled();

    const userCapped = collectCommandPaletteUserCandidates({
      directUsers: [],
      getRoom: (roomId) => roomMap.get(roomId),
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: [largeRoom.roomId],
    });
    expect(userCapped.candidates).toHaveLength(COMMAND_PALETTE_USER_LIMIT);

    vi.mocked(largeRoom.getJoinedMembers).mockClear();
    const directUsers = Array.from(
      { length: COMMAND_PALETTE_USER_LIMIT + 20 },
      (_, index) => `@direct-${index}:example.org`
    );
    const pastCapAccess = vi.fn(() => `@past-cap:example.org`);
    Object.defineProperty(directUsers, COMMAND_PALETTE_USER_LIMIT, {
      configurable: true,
      get: pastCapAccess,
    });
    const directCapped = collectCommandPaletteUserCandidates({
      directUsers,
      getRoom: (roomId) => roomMap.get(roomId),
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: [largeRoom.roomId],
    });
    expect(directCapped.candidates).toHaveLength(COMMAND_PALETTE_USER_LIMIT);
    expect(pastCapAccess).not.toHaveBeenCalled();
    expect(largeRoom.getJoinedMembers).not.toHaveBeenCalled();
  });

  it('does not let a full direct-user list starve selected-room members', () => {
    const selected = makeRoom('!selected:example.org', [
      '@me:example.org',
      '@selected-a:example.org',
      '@selected-b:example.org',
    ]);
    const directUsers = Array.from(
      { length: COMMAND_PALETTE_USER_LIMIT },
      (_, index) => `@direct-${index}:example.org`
    );

    const result = collectCommandPaletteUserCandidates({
      directUsers,
      getRoom: (roomId) => (roomId === selected.roomId ? selected : undefined),
      includeRelatedRooms: false,
      myUserId: '@me:example.org',
      orderedRoomIds: [],
      selectedRoomId: selected.roomId,
    });

    expect(result.candidates).toHaveLength(COMMAND_PALETTE_USER_LIMIT);
    expect(result.candidates.slice(0, 2).map(({ userId }) => userId)).toEqual([
      '@selected-a:example.org',
      '@selected-b:example.org',
    ]);
    expect(result.currentRoomMemberIds).toContain('@selected-a:example.org');
  });

  it('does not enumerate space membership', () => {
    const space = makeRoom('!space:example.org', ['@space-member:example.org'], true);

    const result = collectCommandPaletteUserCandidates({
      directUsers: [],
      getRoom: () => space,
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: [space.roomId],
    });

    expect(result.candidates).toEqual([]);
    expect(space.getJoinedMembers).not.toHaveBeenCalled();
  });

  it('does not visit unrelated rooms for the empty default palette', () => {
    const selected = makeRoom('!selected:example.org', ['@selected:example.org']);
    const unrelated = makeRoom('!unrelated:example.org', ['@unrelated:example.org']);
    const rooms = new Map([
      [selected.roomId, selected],
      [unrelated.roomId, unrelated],
    ]);

    const result = collectCommandPaletteUserCandidates({
      directUsers: ['@direct:example.org'],
      getRoom: (roomId) => rooms.get(roomId),
      includeRelatedRooms: false,
      myUserId: '@me:example.org',
      orderedRoomIds: [unrelated.roomId, selected.roomId],
      selectedRoomId: selected.roomId,
    });

    expect(result.candidates.map((candidate) => candidate.userId)).toEqual([
      '@selected:example.org',
      '@direct:example.org',
    ]);
    expect(unrelated.getJoinedMembers).not.toHaveBeenCalled();
  });

  it('searches beyond the default room cap for an explicit query', () => {
    const rooms = Array.from({ length: COMMAND_PALETTE_USER_ROOM_LIMIT + 1 }, (_, index) =>
      makeRoom(`!room-${index}:example.org`, [`@user-${index}:example.org`])
    );
    const roomMap = new Map(rooms.map((room) => [room.roomId, room]));

    const result = collectCommandPaletteUserCandidates({
      directUsers: [],
      exhaustive: true,
      getRoom: (roomId) => roomMap.get(roomId),
      includeRelatedRooms: true,
      myUserId: '@me:example.org',
      orderedRoomIds: rooms.map((room) => room.roomId),
    });

    expect(result.candidates).toContainEqual(
      expect.objectContaining({ userId: `@user-${COMMAND_PALETTE_USER_ROOM_LIMIT}:example.org` })
    );
  });
});

describe('getCommandPaletteDmUserDetails', () => {
  it('uses a known direct-room member display name without scanning other rooms', () => {
    const userId = '@bob:example.org';
    const room = {
      name: 'Bob chat',
      getMember: vi.fn(() => ({ userId, rawDisplayName: 'Bobby' })),
    } as unknown as Room;

    expect(getCommandPaletteDmUserDetails(room, userId)).toEqual({
      roomName: 'Bob chat',
      displayName: 'Bobby',
    });
    expect(room.getMember).toHaveBeenCalledWith(userId);
  });

  it('leaves MXID-shaped names to the existing localpart fallback', () => {
    const userId = '@bob:example.org';
    const room = {
      name: 'Bob chat',
      getMember: vi.fn(() => ({ userId, rawDisplayName: userId })),
    } as unknown as Room;

    expect(getCommandPaletteDmUserDetails(room, userId).displayName).toBeUndefined();
    expect(getCommandPaletteDmUserDetails(undefined, userId)).toEqual({
      roomName: undefined,
      displayName: undefined,
    });
  });
});

describe('buildCommandPaletteDmRoomMap', () => {
  const makeDmRoom = (
    roomId: string,
    userId: string,
    encrypted = true,
    historicalUserIds: string[] = []
  ) => {
    const joinedMembers = [
      { userId: '@me:example.org', events: {} },
      { userId, events: {} },
    ];
    const members = [
      ...joinedMembers,
      ...historicalUserIds.map((historicalUserId) => ({ userId: historicalUserId, events: {} })),
    ];
    return {
      roomId,
      getMember: (candidateId: string) => members.find((member) => member.userId === candidateId),
      getMembers: () => members,
      getJoinedMemberCount: () => joinedMembers.length,
      getJoinedMembers: () => joinedMembers,
      hasEncryptionStateEvent: () => encrypted,
    } as unknown as Room;
  };

  it('recognizes encrypted two-member DMs even when m.direct is missing', () => {
    const fallbackRoom = makeDmRoom('!fallback:example.org', '@fallback:example.org');

    expect(
      buildCommandPaletteDmRoomMap({
        directRoomIds: [],
        getRoom: () => fallbackRoom,
        joinedRoomIds: [fallbackRoom.roomId],
        myUserId: '@me:example.org',
      }).get('@fallback:example.org')
    ).toBe(fallbackRoom.roomId);
  });

  it('does not infer an unencrypted room as a DM', () => {
    const room = makeDmRoom('!room:example.org', '@bob:example.org', false);

    expect(
      buildCommandPaletteDmRoomMap({
        directRoomIds: [],
        getRoom: () => room,
        joinedRoomIds: [room.roomId],
        myUserId: '@me:example.org',
      })
    ).toEqual(new Map());
  });

  it('ignores departed members when inferring an encrypted two-person DM', () => {
    const room = makeDmRoom('!room:example.org', '@bob:example.org', true, [
      '@departed:example.org',
    ]);

    expect(
      buildCommandPaletteDmRoomMap({
        directRoomIds: [],
        getRoom: () => room,
        joinedRoomIds: [room.roomId],
        myUserId: '@me:example.org',
      }).get('@bob:example.org')
    ).toBe(room.roomId);
  });
});
