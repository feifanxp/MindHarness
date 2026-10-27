import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClient, MatrixEvent, MemoryStore, Room, RoomStateEvent } from 'matrix-js-sdk';
import { roomToParentsAtom, useBindRoomToParentsAtom } from './roomToParents';

enableMapSet();

const ME = '@me:example.org';
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
});

const spaceChildEvent = (spaceId: string, childId: string, linked: boolean) =>
  new MatrixEvent({
    type: 'm.space.child',
    state_key: childId,
    sender: ME,
    room_id: spaceId,
    event_id: `$${spaceId}-${childId}-${linked}`,
    content: linked ? { via: ['example.org'] } : {},
  });

const setup = (spaces: Record<string, string[]>) => {
  const mx = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: ME,
    store: new MemoryStore(),
  });
  const rooms = new Map<string, Room>();
  Object.entries(spaces).forEach(([spaceId, children]) => {
    const space = new Room(spaceId, mx, ME);
    space.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.create',
        state_key: '',
        sender: ME,
        room_id: spaceId,
        event_id: `$${spaceId}-create`,
        content: { type: 'm.space' },
      }),
      ...children.map((childId) => spaceChildEvent(spaceId, childId, true)),
    ]);
    // Sync re-emits room events on the client.
    mx.reEmitter.reEmit(space, [RoomStateEvent.Events]);
    mx.store.storeRoom(space);
    rooms.set(spaceId, space);
  });
  const store = createStore();
  const Binder = () => {
    useBindRoomToParentsAtom(mx, roomToParentsAtom);
    return null;
  };
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Binder)));
  });
  const unlinkChild = (spaceId: string, childId: string) =>
    act(() => {
      rooms.get(spaceId)!.currentState.setStateEvents([spaceChildEvent(spaceId, childId, false)]);
    });
  const parentsOf = (roomId: string) => store.get(roomToParentsAtom).get(roomId);
  return { unlinkChild, parentsOf };
};

describe('useBindRoomToParentsAtom', () => {
  it('keeps the other Space when one of two Spaces removes a room', () => {
    const { unlinkChild, parentsOf } = setup({
      '!space-a:example.org': ['!room:example.org'],
      '!space-b:example.org': ['!room:example.org'],
    });

    unlinkChild('!space-a:example.org', '!room:example.org');

    expect(parentsOf('!room:example.org')).toEqual(new Set(['!space-b:example.org']));
  });

  it('keeps a subspace as the parent of its own rooms when its parent Space removes it', () => {
    const { unlinkChild, parentsOf } = setup({
      '!parent:example.org': ['!subspace:example.org'],
      '!subspace:example.org': ['!room:example.org'],
    });

    unlinkChild('!parent:example.org', '!subspace:example.org');

    expect(parentsOf('!subspace:example.org')).toBeUndefined();
    expect(parentsOf('!room:example.org')).toEqual(new Set(['!subspace:example.org']));
  });

  it("deletes a room's entry when its last Space removes it", () => {
    const { unlinkChild, parentsOf } = setup({
      '!space:example.org': ['!room:example.org', '!other:example.org'],
    });

    unlinkChild('!space:example.org', '!room:example.org');

    expect(parentsOf('!room:example.org')).toBeUndefined();
    expect(parentsOf('!other:example.org')).toEqual(new Set(['!space:example.org']));
  });
});
