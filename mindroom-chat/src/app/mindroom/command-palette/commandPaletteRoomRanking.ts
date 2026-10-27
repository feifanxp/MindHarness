type CommandPaletteRoomRankingInput = {
  roomId: string;
  selectedRoomId?: string;
  selectedSpaceId?: string;
  activityRank: number;
  unreadTotal: number;
  unreadHighlights: number;
};

export const getCommandPaletteRoomRanking = ({
  roomId,
  selectedRoomId,
  selectedSpaceId,
  activityRank,
  unreadTotal,
  unreadHighlights,
}: CommandPaletteRoomRankingInput): { sortRank: number; boost: number } => {
  // Opening the room that is already open goes nowhere. Ranking it below every
  // other room makes the first starter row the room the user most likely wants
  // to switch to.
  if (roomId === selectedRoomId) return { sortRank: 0, boost: 0 };

  return {
    sortRank: activityRank,
    boost:
      (roomId === selectedSpaceId ? 15 : 0) +
      (unreadTotal > 0 ? 15 : 0) +
      (unreadHighlights > 0 ? 10 : 0),
  };
};
