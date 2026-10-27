import { describe, expect, it } from 'vitest';
import {
  getSpaceSearchRooms,
  mergeRoomToParentsSources,
  mergeSearchRoomSources,
} from './useSpaceSearchRooms';

describe('mergeSearchRoomSources', () => {
  it('deduplicates room ids across sdk and atom sources', () => {
    expect(
      mergeSearchRoomSources(
        ['!space-child:example.org', '!sdk-only:example.org'],
        ['!space-child:example.org', '!atom-only:example.org']
      )
    ).toEqual([
      '!space-child:example.org',
      '!sdk-only:example.org',
      '!atom-only:example.org',
    ]);
  });
});

describe('mergeRoomToParentsSources', () => {
  it('unions parent relationships from atom and sdk sources', () => {
    const merged = mergeRoomToParentsSources(
      new Map([['!room:example.org', new Set(['!space-a:example.org'])]]),
      new Map([['!room:example.org', new Set(['!space-b:example.org'])]])
    );

    expect(Array.from(merged.get('!room:example.org') ?? [])).toEqual([
      '!space-a:example.org',
      '!space-b:example.org',
    ]);
  });
});

describe('getSpaceSearchRooms', () => {
  it('includes recursive child rooms from merged space-parent state', () => {
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
          : ({
              getLiveTimeline: () => ({
                getState: () => ({
                  getStateEvents: () => undefined,
                }),
              }),
            } as never),
    } as never;

    expect(
      getSpaceSearchRooms(
        mx,
        '!space:example.org',
        ['!room:example.org', '!dm:example.org'],
        new Set(['!dm:example.org']),
        new Map([['!room:example.org', new Set(['!space:example.org'])]])
      )
    ).toEqual(['!room:example.org']);
  });
});
