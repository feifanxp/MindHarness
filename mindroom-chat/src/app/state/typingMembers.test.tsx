import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  MemoryStore,
  Room,
  RoomMemberEvent,
} from 'matrix-js-sdk';
import {
  TYPING_TIMEOUT_MS,
  roomIdToTypingMembersAtom,
  useBindRoomIdToTypingMembersAtom,
} from './typingMembers';

enableMapSet();

const ROOM_ID = '!room:example.org';
const AGENT = '@agent:example.org';
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  vi.useRealTimers();
});

const setup = () => {
  const mx = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: '@me:example.org',
    store: new MemoryStore(),
  });
  const room = new Room(ROOM_ID, mx, '@me:example.org', { timelineSupport: true });
  mx.store.storeRoom(room);
  room.updateMyMembership(KnownMembership.Join);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: 'm.room.member',
      state_key: AGENT,
      sender: AGENT,
      room_id: ROOM_ID,
      event_id: '$member',
      content: { membership: 'join' },
    }),
  ]);
  // Sync re-emits member events on the client.
  mx.reEmitter.reEmit(room.getMember(AGENT)!, [RoomMemberEvent.Typing]);
  const store = createStore();
  const Binder = () => {
    useBindRoomIdToTypingMembersAtom(mx, roomIdToTypingMembersAtom);
    return null;
  };
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Binder />
      </Provider>
    );
  });
  // The server's m.typing lists everyone typing in the room.
  const serverTyping = (userIds: string[]) =>
    act(() =>
      room.addEphemeralEvents([
        new MatrixEvent({ type: 'm.typing', content: { user_ids: userIds } }),
      ])
    );
  const shown = () =>
    store
      .get(roomIdToTypingMembersAtom)
      .get(ROOM_ID)
      ?.map((r) => r.userId) ?? [];
  return { room, serverTyping, shown };
};

it('shows a member until the server stops listing them as typing', async () => {
  const { serverTyping, shown } = setup();
  serverTyping([AGENT]);
  expect(shown()).toEqual([AGENT]);

  // A long agent turn refreshes typing on the server, which re-sends the same list;
  // the SDK emits nothing for it.
  for (let elapsed = 0; elapsed < 30_000; elapsed += 10_000) {
    // eslint-disable-next-line no-await-in-loop
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    serverTyping([AGENT]);
  }
  expect(shown()).toEqual([AGENT]);

  // Typing turned off and a server timeout both arrive as a list without the member.
  serverTyping([]);
  expect(shown()).toEqual([]);
});

it('keeps hearing typing after a gappy sync', async () => {
  const { room, serverTyping, shown } = setup();
  serverTyping([AGENT]);

  // A gappy sync resets the live timeline while the agent is typing.
  room.resetLiveTimeline('back-token', 'forward-token');
  await act(() => vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS));
  expect(shown()).toEqual([AGENT]);

  serverTyping([]);
  expect(shown()).toEqual([]);
  serverTyping([AGENT]);
  expect(shown()).toEqual([AGENT]);
});

it('stops checking a room we left, which gets no more m.typing', async () => {
  const { room, serverTyping, shown } = setup();
  const timers = vi.getTimerCount();
  serverTyping([AGENT]);
  expect(shown()).toEqual([AGENT]);

  // Leaving or being kicked keeps the room and its typing members in the SDK.
  room.updateMyMembership(KnownMembership.Leave);
  expect(room.getMember(AGENT)?.typing).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS));
  expect(shown()).toEqual([]);
  expect(vi.getTimerCount()).toBe(timers);
});

it('stops checking once the binder unmounts', async () => {
  const { serverTyping, shown } = setup();
  const timers = vi.getTimerCount();
  serverTyping([AGENT]);
  expect(shown()).toEqual([AGENT]);

  act(() => renderer?.unmount());
  renderer = undefined;
  await act(() => vi.advanceTimersByTimeAsync(TYPING_TIMEOUT_MS));
  expect(shown()).toEqual([]);
  expect(vi.getTimerCount()).toBe(timers);
});
