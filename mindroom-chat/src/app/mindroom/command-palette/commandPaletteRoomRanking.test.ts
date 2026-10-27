import { describe, expect, it } from 'vitest';
import { getCommandPaletteRoomRanking } from './commandPaletteRoomRanking';

const base = {
  roomId: '!room:example.org',
  activityRank: 12,
  unreadTotal: 0,
  unreadHighlights: 0,
};

describe('getCommandPaletteRoomRanking', () => {
  it('ranks other rooms by activity and boosts unread rooms', () => {
    expect(getCommandPaletteRoomRanking(base)).toEqual({ sortRank: 12, boost: 0 });
    expect(getCommandPaletteRoomRanking({ ...base, unreadTotal: 3 })).toEqual({
      sortRank: 12,
      boost: 15,
    });
    expect(getCommandPaletteRoomRanking({ ...base, unreadTotal: 3, unreadHighlights: 1 })).toEqual({
      sortRank: 12,
      boost: 25,
    });
  });

  it('boosts the selected space', () => {
    expect(getCommandPaletteRoomRanking({ ...base, selectedSpaceId: '!room:example.org' })).toEqual(
      { sortRank: 12, boost: 15 }
    );
  });

  it('sinks the room that is already open, since opening it again goes nowhere', () => {
    expect(
      getCommandPaletteRoomRanking({
        ...base,
        selectedRoomId: '!room:example.org',
        unreadTotal: 3,
        unreadHighlights: 1,
      })
    ).toEqual({ sortRank: 0, boost: 0 });
  });
});
