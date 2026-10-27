import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MatrixClient, MatrixEvent, type Thread } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { loadRoomThreads } from './roomThreadList';
import { useRoomThreadList } from './useRoomThreadList';
import { loadCachedThreadRootsForRoom } from './eventRepository';
import { MindroomSyncEngineProvider } from '../engine/engineContext';
import { createMindroomSyncEngine } from '../engine/mindroomSyncEngine';

vi.mock('./roomThreadList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./roomThreadList')>();
  return {
    ...original,
    loadRoomThreads: vi.fn(),
  };
});

vi.mock('./eventRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./eventRepository')>()),
  loadCachedThreadRootsForRoom: vi.fn(async () => []),
}));

const mockedLoadRoomThreads = vi.mocked(loadRoomThreads);

type ThreadListSnapshot = ReturnType<typeof useRoomThreadList>;

function Harness({
  enabled,
  onRender,
  room,
}: {
  enabled: boolean;
  onRender: (snapshot: ThreadListSnapshot) => void;
  room: Room;
}) {
  onRender(useRoomThreadList(room, enabled));
  return null;
}

const makeRoom = () =>
  ({
    roomId: '!room:example.org',
    getThreads: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
    threadsTimelineSets: [],
  } as unknown as Room);

afterEach(() => {
  mockedLoadRoomThreads.mockReset();
  vi.mocked(loadCachedThreadRootsForRoom).mockReset().mockResolvedValue([]);
});

describe('useRoomThreadList', () => {
  it('retains known root fallbacks without unread or history work while disabled', async () => {
    mockedLoadRoomThreads.mockResolvedValue(undefined);
    const root = new MatrixEvent({
      event_id: '$root',
      origin_server_ts: 10,
      type: 'm.room.message',
      content: { body: 'Root', msgtype: 'm.text' },
    });
    const historyRead = vi.fn(() => []);
    const thread = {
      id: '$root',
      rootEvent: root,
      get events() {
        return historyRead();
      },
    } as unknown as Thread;
    const room = { ...makeRoom(), getThreads: () => [thread] } as Room;
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@self:example.org' });
    const engine = createMindroomSyncEngine({ mx });
    let snapshot!: ThreadListSnapshot;
    let renderer!: ReactTestRenderer;
    const render = (enabled: boolean) => (
      <MatrixClientProvider value={mx}>
        <MindroomSyncEngineProvider engine={engine}>
          <Harness
            room={room}
            enabled={enabled}
            onRender={(value) => {
              snapshot = value;
            }}
          />
        </MindroomSyncEngineProvider>
      </MatrixClientProvider>
    );
    await act(async () => {
      renderer = create(render(false));
    });
    expect(snapshot.threads).toEqual([thread]);
    expect(snapshot.threadUnreads.size).toBe(0);
    expect(historyRead).not.toHaveBeenCalled();
    await act(async () => {
      renderer.update(render(true));
    });
    expect(snapshot.threads).toEqual([thread]);
    expect(snapshot.threadUnreads.get('$root')).toBe(false);
    expect(historyRead).toHaveBeenCalled();
    renderer.unmount();
  });
  it('cancels automatic and retry loads together without applying a stale retry error', async () => {
    const pendingLoads: Array<{
      reject: (error: Error) => void;
      signal: AbortSignal | undefined;
    }> = [];
    mockedLoadRoomThreads.mockImplementation((_room, _onProgress, signal) => {
      const promise = new Promise<void>((_resolve, reject) => {
        pendingLoads.push({ reject, signal });
      });
      return promise;
    });

    const room = makeRoom();
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@self:example.org' });
    const engine = createMindroomSyncEngine({ mx });
    let snapshot: ThreadListSnapshot | undefined;
    let renderer!: ReactTestRenderer;
    const render = (enabled: boolean) => (
      <MatrixClientProvider value={mx}>
        <MindroomSyncEngineProvider engine={engine}>
          <Harness
            enabled={enabled}
            onRender={(value) => {
              snapshot = value;
            }}
            room={room}
          />
        </MindroomSyncEngineProvider>
      </MatrixClientProvider>
    );

    await act(async () => {
      renderer = create(render(true));
    });
    expect(pendingLoads).toHaveLength(1);

    let retry: Promise<void> | undefined;
    await act(async () => {
      retry = snapshot?.retry();
    });
    expect(pendingLoads).toHaveLength(2);
    expect(pendingLoads[0].signal).toBe(pendingLoads[1].signal);
    expect(pendingLoads[0].signal?.aborted).toBe(false);

    await act(async () => {
      renderer.update(render(false));
    });
    expect(pendingLoads[0].signal?.aborted).toBe(true);

    await act(async () => {
      pendingLoads.forEach(({ reject }) => reject(new Error('late failure')));
      await retry;
    });

    expect(snapshot?.loading).toBe(false);
    expect(snapshot?.error).toBeUndefined();

    renderer.unmount();
  });
  it('reads the cached roots of a room once per page, retrying after a failed read', async () => {
    mockedLoadRoomThreads.mockResolvedValue(undefined);
    vi.mocked(loadCachedThreadRootsForRoom).mockRejectedValueOnce(new Error('Cache closed'));
    const room = makeRoom();
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@self:example.org' });
    const engine = createMindroomSyncEngine({ mx });
    const mount = async () => {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <MatrixClientProvider value={mx}>
            <MindroomSyncEngineProvider engine={engine}>
              <Harness enabled room={room} onRender={() => undefined} />
            </MindroomSyncEngineProvider>
          </MatrixClientProvider>
        );
      });
      await act(async () => renderer.unmount());
    };

    await mount();
    await mount();
    await mount();

    // The failed read is retried; the SDK keeps the threads of the successful one.
    expect(loadCachedThreadRootsForRoom).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])(
    'keeps a cache failure separate from server success (cache first: %s)',
    async (cacheFirst) => {
      let rejectCache!: (error: Error) => void;
      let completeServer!: () => void;
      vi.mocked(loadCachedThreadRootsForRoom).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectCache = reject;
        })
      );
      mockedLoadRoomThreads.mockImplementation(
        (_room, onProgress) =>
          new Promise((resolve) => {
            completeServer = () => {
              onProgress?.();
              resolve();
            };
          })
      );
      const room = makeRoom();
      const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@self:example.org' });
      const engine = createMindroomSyncEngine({ mx });
      let snapshot: ThreadListSnapshot | undefined;
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <MatrixClientProvider value={mx}>
            <MindroomSyncEngineProvider engine={engine}>
              <Harness
                enabled
                room={room}
                onRender={(value) => {
                  snapshot = value;
                }}
              />
            </MindroomSyncEngineProvider>
          </MatrixClientProvider>
        );
      });
      const failCache = () => rejectCache(new Error('Cache transaction failed'));
      await act(async () => {
        (cacheFirst ? failCache : completeServer)();
      });
      await act(async () => {
        (cacheFirst ? completeServer : failCache)();
      });
      expect(snapshot?.loadedSuccessfully).toBe(true);
      expect(snapshot?.loading).toBe(false);
      expect(snapshot?.error).toBeUndefined();
      renderer.unmount();
    }
  );
});
