import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { enableMapSet } from 'immer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mDirectAtom, useBindMDirectAtom } from './mDirectList';
import { roomIdToTypingMembersAtom, useBindRoomIdToTypingMembersAtom } from './typingMembers';

enableMapSet();

const createClient = () => ({
  getAccountData: vi.fn(() => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
});

describe('account atom binding resets', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    vi.useRealTimers();
  });

  it('clears the previous account direct-room list when account data is absent', () => {
    const store = createStore();
    store.set(mDirectAtom, {
      type: 'INITIALIZE',
      rooms: new Set(['!private-a:example.org']),
    });
    const client = createClient();

    const Binder = () => {
      useBindMDirectAtom(client as never, mDirectAtom);
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <Binder />
        </Provider>
      );
    });

    expect(store.get(mDirectAtom)).toEqual(new Set());
  });

  it('clears typing receipts before listening for the next account', () => {
    vi.useFakeTimers();
    const store = createStore();
    store.set(roomIdToTypingMembersAtom, {
      type: 'PUT',
      roomId: '!room-a:example.org',
      userId: '@alice:example.org',
      ts: Date.now(),
      isTyping: () => true,
    });
    const client = createClient();

    const Binder = () => {
      useBindRoomIdToTypingMembersAtom(client as never, roomIdToTypingMembersAtom);
      return null;
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <Binder />
        </Provider>
      );
    });

    expect(store.get(roomIdToTypingMembersAtom)).toEqual(new Map());
  });
});
