import type { Room } from 'matrix-js-sdk';
import { guessDmRoomUserId } from '../../utils/matrix';

export const COMMAND_PALETTE_USER_LIMIT = 200;
export const COMMAND_PALETTE_USER_ROOM_LIMIT = 20;

export type CommandPaletteUserCandidate = {
  userId: string;
  displayName?: string;
  sourceRoomId?: string;
};

export const buildCommandPaletteDmRoomMap = ({
  directRoomIds,
  getRoom,
  joinedRoomIds,
  myUserId,
}: {
  directRoomIds: readonly string[];
  getRoom: (roomId: string) => Room | undefined;
  joinedRoomIds: readonly string[];
  myUserId: string;
}): Map<string, string> => {
  const roomByUserId = new Map<string, string>();
  const directRoomIdSet = new Set(directRoomIds);

  const addRoom = (roomId: string, requireDmShape: boolean) => {
    const room = getRoom(roomId);
    if (!room) return;
    if (requireDmShape && (!room.hasEncryptionStateEvent() || room.getJoinedMemberCount() !== 2)) {
      return;
    }

    const userId = guessDmRoomUserId(room, myUserId);
    if (!userId || userId === myUserId || roomByUserId.has(userId)) return;
    roomByUserId.set(userId, room.roomId);
  };

  directRoomIds.forEach((roomId) => addRoom(roomId, false));
  joinedRoomIds.forEach((roomId) => {
    if (!directRoomIdSet.has(roomId)) addRoom(roomId, true);
  });

  return roomByUserId;
};

export const getCommandPaletteDmUserDetails = (room: Room | undefined, userId: string) => {
  const member = room?.getMember(userId);
  return {
    roomName: room?.name,
    displayName:
      member && member.rawDisplayName !== member.userId ? member.rawDisplayName : undefined,
  };
};

export const collectCommandPaletteUserCandidates = ({
  directUsers,
  exhaustive = false,
  getRoom,
  includeRelatedRooms,
  myUserId,
  orderedRoomIds,
  selectedRoomId,
}: {
  directUsers: Iterable<string>;
  exhaustive?: boolean;
  getRoom: (roomId: string) => Room | undefined;
  includeRelatedRooms: boolean;
  myUserId: string;
  orderedRoomIds: readonly string[];
  selectedRoomId?: string;
}): {
  candidates: CommandPaletteUserCandidate[];
  currentRoomMemberIds: Set<string>;
} => {
  const candidates = new Map<string, CommandPaletteUserCandidate>();
  const currentRoomMemberIds = new Set<string>();
  const candidateLimit = exhaustive ? Number.POSITIVE_INFINITY : COMMAND_PALETTE_USER_LIMIT;
  const roomLimit = exhaustive ? Number.POSITIVE_INFINITY : COMMAND_PALETTE_USER_ROOM_LIMIT;
  const addCandidate = (candidate: CommandPaletteUserCandidate) => {
    if (!candidate.userId || candidate.userId === myUserId) return;
    const existing = candidates.get(candidate.userId);
    if (existing) {
      if (!existing.displayName && candidate.displayName) {
        existing.displayName = candidate.displayName;
      }
      return;
    }
    if (candidates.size >= candidateLimit) return;
    candidates.set(candidate.userId, candidate);
  };

  let visitedRooms = 0;
  const visitRoom = (roomId: string): boolean => {
    if (candidates.size >= candidateLimit) return true;
    if (visitedRooms >= roomLimit) return true;
    const room = getRoom(roomId);
    if (!room || room.isSpaceRoom()) return false;
    visitedRooms += 1;

    for (const member of room.getJoinedMembers()) {
      if (roomId === selectedRoomId) currentRoomMemberIds.add(member.userId);
      addCandidate({
        userId: member.userId,
        displayName: member.rawDisplayName !== member.userId ? member.rawDisplayName : undefined,
        sourceRoomId: room.roomId,
      });
      if (candidates.size >= candidateLimit) break;
    }
    return candidates.size >= candidateLimit;
  };

  // The current room is the strongest user intent. Visit it before a large
  // m.direct list can consume the global cap and make its members unsearchable.
  if (selectedRoomId) visitRoom(selectedRoomId);

  if (candidates.size < candidateLimit) {
    for (const userId of directUsers) {
      addCandidate({ userId });
      if (candidates.size >= candidateLimit) break;
    }
  }

  if (includeRelatedRooms) {
    for (const roomId of orderedRoomIds) {
      if (roomId === selectedRoomId) continue;
      if (visitRoom(roomId)) break;
    }
  }

  return { candidates: Array.from(candidates.values()), currentRoomMemberIds };
};
