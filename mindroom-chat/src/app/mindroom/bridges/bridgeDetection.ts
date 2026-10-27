type RoomMemberLike = {
  userId?: string | null;
  membership?: string | null;
};

type RoomLike = {
  getMembers: () => RoomMemberLike[];
};

const ACTIVE_MEMBERSHIPS = new Set(['join', 'invite']);

export const isSignalBridgeUserId = (userId: string): boolean => {
  const match = /^@([^:]+):/.exec(userId);
  if (!match) return false;

  const localpart = match[1].toLowerCase();
  return localpart === 'signalbot' || localpart.startsWith('signalbot_');
};

export const isSignalBridgeRoom = (room: RoomLike): boolean =>
  room.getMembers().some((member) => {
    if (!member.userId || !member.membership) return false;
    if (!ACTIVE_MEMBERSHIPS.has(member.membership)) return false;
    return isSignalBridgeUserId(member.userId);
  });
