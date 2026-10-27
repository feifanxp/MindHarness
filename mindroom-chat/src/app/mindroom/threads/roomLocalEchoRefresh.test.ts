import React from 'react';
import { RoomEvent, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useRoomLocalEchoRefresh } from './roomLocalEchoRefresh';

type MockRoom = {
  roomId: string;
  on: (eventName: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (eventName: string, listener: (...args: unknown[]) => void) => void;
  emit: (eventName: string, ...args: unknown[]) => void;
  listenerCount: (eventName: string) => number;
};

const makeRoom = (roomId = '!room:example.org'): MockRoom => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    roomId,
    on: (eventName: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    removeListener: (eventName: string, listener: (...args: unknown[]) => void) => {
      listeners.get(eventName)?.delete(listener);
    },
    emit: (eventName: string, ...args: unknown[]) => {
      listeners.get(eventName)?.forEach((listener) => listener(...args));
    },
    listenerCount: (eventName: string) => listeners.get(eventName)?.size ?? 0,
  };
};

const LocalEchoHarness = ({ onRefresh, room }: { onRefresh: () => void; room: MockRoom }) => {
  useRoomLocalEchoRefresh(room as unknown as Room, onRefresh);
  return null;
};

describe('useRoomLocalEchoRefresh', () => {
  it('refreshes when a local echo update belongs to the room', async () => {
    const room = makeRoom();
    const onRefresh = vi.fn();

    await act(async () => {
      create(React.createElement(LocalEchoHarness, { room, onRefresh }));
    });
    await act(async () => {
      room.emit(RoomEvent.LocalEchoUpdated, {}, room);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('removes the local echo listener on unmount', async () => {
    const room = makeRoom();
    const onRefresh = vi.fn();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(LocalEchoHarness, { room, onRefresh }));
    });
    expect(room.listenerCount(RoomEvent.LocalEchoUpdated)).toBe(1);

    await act(async () => {
      renderer?.unmount();
    });
    expect(room.listenerCount(RoomEvent.LocalEchoUpdated)).toBe(0);

    await act(async () => {
      room.emit(RoomEvent.LocalEchoUpdated, {}, room);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
