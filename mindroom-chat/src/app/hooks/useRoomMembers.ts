import { MatrixClient, MatrixEvent, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { useEffect, useState } from 'react';

export const useRoomMembers = (mx: MatrixClient, roomId: string): RoomMember[] => {
  const [members, setMembers] = useState<RoomMember[]>(
    () => mx.getRoom(roomId)?.getMembers() ?? []
  );

  useEffect(() => {
    const room = mx.getRoom(roomId);
    let disposed = false;

    const updateMemberList = (event?: MatrixEvent) => {
      if (!room || disposed || (event && event.getRoomId() !== roomId)) return;
      setMembers(room.getMembers());
    };

    if (room) {
      setMembers(room.getMembers());
      room
        .loadMembersIfNeeded()
        .then(() => {
          if (disposed) return;
          updateMemberList();
        })
        .catch((error) => {
          if (disposed) return;
          logger.warn('[useRoomMembers] Failed to load room members', error);
        });
    }

    mx.on(RoomMemberEvent.Membership, updateMemberList);
    mx.on(RoomMemberEvent.PowerLevel, updateMemberList);
    return () => {
      disposed = true;
      mx.removeListener(RoomMemberEvent.Membership, updateMemberList);
      mx.removeListener(RoomMemberEvent.PowerLevel, updateMemberList);
    };
  }, [mx, roomId]);

  return members;
};
