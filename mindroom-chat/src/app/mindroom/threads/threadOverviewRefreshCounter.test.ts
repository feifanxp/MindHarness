import React, { useEffect } from 'react';
import { RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';

const makeRoom = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    roomId: '!room:example.org',
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
  } as never;
};

const CounterHarness = ({
  onCounter,
  room,
  threadId,
}: {
  onCounter: (counter: number) => void;
  room: ReturnType<typeof makeRoom>;
  threadId?: string;
}) => {
  const { overviewRefreshCounter } = useThreadOverviewRefreshCounter(room, threadId);
  useEffect(() => {
    onCounter(overviewRefreshCounter);
  }, [onCounter, overviewRefreshCounter]);
  return null;
};

describe('useThreadOverviewRefreshCounter', () => {
  it('bumps for room overview receipt and thread events', async () => {
    const room = makeRoom();
    const counters: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(CounterHarness, {
          onCounter: (counter) => counters.push(counter),
          room,
        })
      );
    });
    await act(async () => {
      room.emit(RoomEvent.Receipt, undefined, room);
    });
    await act(async () => {
      room.emit(ThreadEvent.Update);
    });

    expect(counters).toEqual([0, 1, 2]);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not subscribe while inside a thread route', async () => {
    const room = makeRoom();
    const counters: number[] = [];

    await act(async () => {
      create(
        React.createElement(CounterHarness, {
          onCounter: (counter) => counters.push(counter),
          room,
          threadId: '$thread',
        })
      );
    });
    await act(async () => {
      room.emit(RoomEvent.Receipt, undefined, room);
      room.emit(ThreadEvent.Update);
    });

    expect(counters).toEqual([0]);
  });
});
