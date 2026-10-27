import { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { acceptInvites } from './acceptInvite';

type FakeRoom = { roomId: string; direct: boolean; membership: string };

vi.mock('../../../utils/room', () => ({
  isDirectInvite: (room: FakeRoom) => room.direct,
}));

vi.mock('../../../utils/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/matrix')>()),
  guessDmRoomUserId: (room: FakeRoom) => `@partner-of-${room.roomId.slice(1)}`,
  addRoomIdToMDirect: vi.fn(),
}));

const { addRoomIdToMDirect } = vi.mocked(await import('../../../utils/matrix'));

const room = (roomId: string, direct = false, membership = 'invite') => {
  const fake = { roomId, direct, membership, getMyMembership: () => fake.membership };
  return fake;
};

describe('acceptInvites', () => {
  it('joins every pending invite, records DMs, and keeps going after a failed join', async () => {
    const rooms = [
      room('!a:example.org'),
      room('!broken:example.org', true),
      room('!declined:example.org', false, 'leave'),
      room('!dm:example.org', true),
    ];
    const joinRoom = vi.fn(async (roomId: string) => {
      if (roomId === '!broken:example.org') throw new Error('join failed');
      // Joining replaces our invite member event, so is_direct is gone afterwards.
      const joined = rooms.find((r) => r.roomId === roomId)!;
      joined.direct = false;
      joined.membership = 'join';
    });
    const mx = { getSafeUserId: () => '@me:example.org', joinRoom } as unknown as MatrixClient;

    await acceptInvites(mx, rooms as unknown as Room[]);

    expect(joinRoom.mock.calls.map(([roomId]) => roomId)).toEqual([
      '!a:example.org',
      '!broken:example.org',
      '!dm:example.org',
    ]);
    expect(addRoomIdToMDirect).toHaveBeenCalledTimes(1);
    expect(addRoomIdToMDirect).toHaveBeenCalledWith(
      mx,
      '!dm:example.org',
      '@partner-of-dm:example.org'
    );
  });
});
