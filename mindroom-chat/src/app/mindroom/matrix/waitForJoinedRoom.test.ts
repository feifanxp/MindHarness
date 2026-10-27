import { ClientEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { waitForJoinedRoom } from './waitForJoinedRoom';

describe('waitForJoinedRoom', () => {
  it('waits for the room to arrive through sync', async () => {
    const mx = { getRoom: vi.fn(() => null), on: vi.fn(), removeListener: vi.fn() };
    const pending = waitForJoinedRoom(mx as never, '!room:example.com', 1_000);
    const listener = mx.on.mock.calls.find(([event]) => event === ClientEvent.Room)?.[1];
    const room = { roomId: '!room:example.com' } as Room;

    listener(room);

    await expect(pending).resolves.toBe(room);
    expect(mx.removeListener).toHaveBeenCalledWith(ClientEvent.Room, listener);
  });
});
