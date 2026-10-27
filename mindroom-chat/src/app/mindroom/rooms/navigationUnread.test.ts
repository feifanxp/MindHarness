import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { archivedRoomsAtom } from './archivedRooms';
import { navigationRoomToUnreadAtom } from './navigationUnread';

describe('navigation unread counts', () => {
  it('removes archived contributions from nested spaces without marking rooms read', () => {
    const store = createStore();
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        ['!hidden:test', new Set(['!nested:test'])],
        ['!nested:test', new Set(['!space:test'])],
        ['!visible:test', new Set(['!space:test'])],
      ]),
    });
    store.set(roomToUnreadAtom, {
      type: 'RESET',
      unreadInfos: [
        { roomId: '!hidden:test', total: 4, highlight: 2 },
        { roomId: '!visible:test', total: 1, highlight: 0 },
      ],
    });
    store.set(archivedRoomsAtom, new Set(['!hidden:test']));
    const unread = store.get(navigationRoomToUnreadAtom);
    expect(unread.has('!hidden:test')).toBe(false);
    expect(unread.has('!nested:test')).toBe(false);
    expect(unread.get('!space:test')).toEqual({
      total: 1,
      highlight: 0,
      from: new Set(['!visible:test']),
    });
    expect(store.get(roomToUnreadAtom).get('!space:test')?.total).toBe(5);
    store.set(archivedRoomsAtom, new Set<string>());
    expect(store.get(navigationRoomToUnreadAtom).get('!space:test')?.total).toBe(5);
  });
});
