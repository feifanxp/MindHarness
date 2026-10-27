import { describe, expect, it } from 'vitest';
import { getHomeSearchRooms, mergeHomeSearchRoomSources } from './useHomeRooms';

describe('getHomeSearchRooms', () => {
  it('filters directs, child rooms, and known spaces from the search scope', () => {
    const mx = {
      getRoom: (roomId: string) =>
        roomId === '!space:example.org'
          ? ({
              getLiveTimeline: () => ({
                getState: () => ({
                  getStateEvents: () => ({
                    getContent: () => ({ type: 'm.space' }),
                  }),
                }),
              }),
            } as never)
          : null,
    } as never;

    expect(
      getHomeSearchRooms(
        mx,
        [
          '!root:example.org',
          '!space:example.org',
          '!child:example.org',
          '!dm:example.org',
        ],
        new Set(['!dm:example.org']),
        new Map([['!child:example.org', new Set(['!space:example.org'])]])
      )
    ).toEqual(['!root:example.org']);
  });

  it('deduplicates room ids when multiple room sources are merged upstream', () => {
    expect(
      mergeHomeSearchRoomSources(
        ['!root:example.org', '!sdk-only:example.org'],
        ['!root:example.org', '!other:example.org']
      )
    ).toEqual(['!root:example.org', '!sdk-only:example.org', '!other:example.org']);
  });
});
