import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncState } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createMindroomSyncEngine } from '../mindroomSyncEngine';
import { StateEvent } from '../../../../types/matrix/room';
import {
  getEvictionProtectedRoomIds,
  __resetEvictionForTests,
  openCacheStore,
  resetCacheStoreForTesting,
  ROOM_LEDGER_STORE,
  type CachedRoomLedgerRecord,
} from '../../threads/cacheStore';

const HOMESERVER_URL = 'https://mindroom.chat';
const OUR_DOMAIN = 'mindroom.chat';
const USER_ID = '@bob:mindroom.chat';

const makeCreateEvent = (sender: string): MatrixEvent =>
  ({
    getSender: () => sender,
  }) as unknown as MatrixEvent;

const makeRoom = (roomId: string, createSender: string | undefined): Room =>
  ({
    roomId,
    hasEncryptionStateEvent: () => false,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: StateEvent) => {
          if (eventType !== StateEvent.RoomCreate) return undefined;
          return createSender ? makeCreateEvent(createSender) : undefined;
        },
      }),
    }),
    getLastActiveTimestamp: () => 0,
  }) as unknown as Room;

const createClient = (rooms: Map<string, Room>): MatrixClient =>
  ({
    on: () => undefined,
    removeListener: () => undefined,
    getSyncState: () => SyncState.Syncing,
    getHomeserverUrl: () => HOMESERVER_URL,
    getSafeUserId: () => USER_ID,
    getDomain: () => OUR_DOMAIN,
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    getRooms: () => Array.from(rooms.values()),
  }) as unknown as MatrixClient;

const readLedgerRow = async (
  sessionId: string,
  roomId: string
): Promise<CachedRoomLedgerRecord | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const txn = db.transaction(ROOM_LEDGER_STORE, 'readonly');
    const store = txn.objectStore(ROOM_LEDGER_STORE);
    const req = store.get(roomId);
    req.onsuccess = () => resolve(req.result as CachedRoomLedgerRecord | undefined);
    req.onerror = () => reject(req.error);
  });
};

describe('engine.noteRoomFocused (CINNY-207 P4.2)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    __resetEvictionForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    __resetEvictionForTests();
  });

  it('stamps ledger.federated=false and protects the room for a same-server room', async () => {
    const rooms = new Map<string, Room>();
    rooms.set('!own:mindroom.chat', makeRoom('!own:mindroom.chat', '@alice:mindroom.chat'));
    const mx = createClient(rooms);
    const engine = createMindroomSyncEngine({ mx });

    engine.noteRoomFocused('!own:mindroom.chat');
    // The ledger write is async with no returned promise; poll until it
    // lands. A fixed sleep flakes under full-suite CPU contention.
    const row = await vi.waitFor(
      async () => {
        const candidate = await readLedgerRow(engine.sessionId, '!own:mindroom.chat');
        expect(candidate).toBeDefined();
        return candidate;
      },
      { timeout: 2000, interval: 10 }
    );
    expect(row?.federated).toBe(false);
    expect(getEvictionProtectedRoomIds()).toEqual(['!own:mindroom.chat']);
  });

  it('stamps ledger.federated=true for a room created on another homeserver', async () => {
    const rooms = new Map<string, Room>();
    rooms.set('!fed:example.org', makeRoom('!fed:example.org', '@carol:example.org'));
    const mx = createClient(rooms);
    const engine = createMindroomSyncEngine({ mx });

    engine.noteRoomFocused('!fed:example.org');
    // Poll — see the same-server test above for why a fixed sleep flakes.
    const row = await vi.waitFor(
      async () => {
        const candidate = await readLedgerRow(engine.sessionId, '!fed:example.org');
        expect(candidate).toBeDefined();
        return candidate;
      },
      { timeout: 2000, interval: 10 }
    );
    expect(row?.federated).toBe(true);
    expect(getEvictionProtectedRoomIds()).toEqual(['!fed:example.org']);
  });

  it('leaves ledger.federated untouched when the create event is missing (background tier)', async () => {
    const rooms = new Map<string, Room>();
    rooms.set('!bg:unknown', makeRoom('!bg:unknown', undefined));
    const mx = createClient(rooms);
    const engine = createMindroomSyncEngine({ mx });

    engine.noteRoomFocused('!bg:unknown');
    // Absence can't be polled-for; give the (should-not-happen) write a
    // generous settle window instead of the flaky 20ms.
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    const row = await readLedgerRow(engine.sessionId, '!bg:unknown');
    // No ledger row is created for background rooms because we don't
    // know the federation truth. Confirms the tier gate is honored.
    expect(row).toBeUndefined();
  });

  it('replaces the protection set with the currently-focused room (single-element v1)', async () => {
    const rooms = new Map<string, Room>();
    rooms.set('!a:mindroom.chat', makeRoom('!a:mindroom.chat', '@alice:mindroom.chat'));
    rooms.set('!b:mindroom.chat', makeRoom('!b:mindroom.chat', '@alice:mindroom.chat'));
    const mx = createClient(rooms);
    const engine = createMindroomSyncEngine({ mx });

    engine.noteRoomFocused('!a:mindroom.chat');
    expect(getEvictionProtectedRoomIds()).toEqual(['!a:mindroom.chat']);
    engine.noteRoomFocused('!b:mindroom.chat');
    expect(getEvictionProtectedRoomIds()).toEqual(['!b:mindroom.chat']);
  });
});
