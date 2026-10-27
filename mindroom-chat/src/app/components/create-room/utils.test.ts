import { describe, expect, it, vi } from 'vitest';
import { RoomType } from '../../../types/matrix/room';
import { CreateRoomAccess } from './types';
import { createRoom } from './utils';

describe('createRoom', () => {
  it.each([
    ['11', 100],
    ['12', 150],
  ])(
    'keeps the server pinned power levels in a version %s voice room',
    async (version, tombstone) => {
      const mx = {
        createRoom: vi.fn().mockResolvedValue({ room_id: '!voice:mindroom.test' }),
      } as any;

      await createRoom(mx, {
        version,
        type: RoomType.Call,
        access: CreateRoomAccess.Private,
        name: 'Voice',
        knock: false,
        allowFederation: true,
      });

      expect(mx.createRoom.mock.calls[0][0].power_level_content_override).toEqual({
        events: {
          'm.room.power_levels': 100,
          'm.room.server_acl': 100,
          'm.room.encryption': 100,
          'm.room.history_visibility': 100,
          'm.room.tombstone': tombstone,
          'org.matrix.msc3401.call.member': 0,
        },
      });
    }
  );
});
