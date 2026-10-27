import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb';

/** A canvas made for this user, as the Canvases page lists it. */
export type CanvasListEntry = {
  canvasId: string;
  roomId: string;
  threadId?: string;
  agentUserId: string;
  title: string;
  createdTs: number;
  /** The event the shown version comes from, the latest update or the request, and when it was sent. */
  revisionId: string;
  updatedTs: number;
  shared: boolean;
};

/** A conversation that received a `show_computer` notice for this user. */
type ComputerShown = { key: string; roomId: string; threadId?: string };

// Entries are a few hundred bytes, so the list is not bounded (unlike saved canvas state).
interface CanvasIndexDb extends DBSchema {
  canvases: { key: string; value: CanvasListEntry };
  computerShown: { key: string; value: ComputerShown };
}

type StoreName = 'canvases' | 'computerShown';
type Store<Name extends StoreName> = IDBPObjectStore<CanvasIndexDb, [Name], Name, 'readwrite'>;

// A conversation is its room and thread root; the room's main timeline has no thread.
const conversationKey = (roomId: string, threadId: string | undefined): string =>
  `${roomId}\n${threadId ?? ''}`;

/** One database per session, deleted with the session's other data at logout (`sessionLifecycle.ts`). */
export const getCanvasIndexDbName = (sessionId: string): string =>
  `mindroom-canvas-index::${sessionId}`;

const openIndexDb = (sessionId: string): Promise<IDBPDatabase<CanvasIndexDb>> =>
  openDB<CanvasIndexDb>(getCanvasIndexDbName(sessionId), 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('canvases', { keyPath: 'canvasId' });
      if (oldVersion < 2) db.createObjectStore('computerShown', { keyPath: 'key' });
    },
  });

const listeners = new Set<() => void>();

/** Calls the listener after each write to a session's list; returns the unsubscribe. */
export const subscribeCanvasList = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Runs one write in its own transaction, then tells listeners, also when it changed nothing:
 * another tab of the session may have written the same change first, unheard by this tab.
 */
const write = async <Name extends StoreName>(
  sessionId: string,
  name: Name,
  apply: (store: Store<Name>) => Promise<unknown>
) => {
  const db = await openIndexDb(sessionId);
  try {
    const tx = db.transaction(name, 'readwrite');
    // A failed request fails the transaction too; the caller hears of the request's failure only.
    tx.done.catch(() => undefined);
    await apply(tx.store);
    await tx.done;
    listeners.forEach((listener) => listener());
  } finally {
    db.close();
  }
};

/** Adds a canvas or refreshes it; an older copy of the request never rolls back a newer update. */
export const recordCanvas = (sessionId: string, entry: CanvasListEntry): Promise<void> =>
  write(sessionId, 'canvases', async (store) => {
    const known = await store.get(entry.canvasId);
    await store.put(
      known && known.updatedTs > entry.updatedTs
        ? { ...entry, title: known.title, revisionId: known.revisionId, updatedTs: known.updatedTs }
        : entry
    );
  });

/** Applies an update of a listed canvas when it is the newest seen and `versionFor` accepts it. */
export const recordCanvasUpdate = (
  sessionId: string,
  canvasId: string,
  ts: number,
  versionFor: (known: CanvasListEntry) => { title: string; revisionId: string } | undefined
): Promise<void> =>
  write(sessionId, 'canvases', async (store) => {
    const known = await store.get(canvasId);
    const version = known && ts >= known.updatedTs ? versionFor(known) : undefined;
    if (known && version) await store.put({ ...known, ...version, updatedTs: ts });
  });

/** Replaces a row with its surviving version, if it still shows the deleted one. */
export const replaceDeletedVersion = (
  sessionId: string,
  deletedId: string,
  entry: CanvasListEntry
): Promise<void> =>
  write(sessionId, 'canvases', async (store) => {
    if ((await store.get(entry.canvasId))?.revisionId === deletedId) await store.put(entry);
  });

export const forgetCanvas = (sessionId: string, canvasId: string): Promise<void> =>
  write(sessionId, 'canvases', (store) => store.delete(canvasId));

export const listCanvases = async (sessionId: string): Promise<CanvasListEntry[]> => {
  const db = await openIndexDb(sessionId);
  try {
    return await db.getAll('canvases');
  } finally {
    db.close();
  }
};

export const hasCanvases = async (sessionId: string): Promise<boolean> => {
  const db = await openIndexDb(sessionId);
  try {
    return (await db.count('canvases')) > 0;
  } finally {
    db.close();
  }
};

/** Notes that an agent asked for the computer view in this conversation. */
export const recordComputerShown = (
  sessionId: string,
  roomId: string,
  threadId: string | undefined
): Promise<void> =>
  write(sessionId, 'computerShown', (store) =>
    store.put({ key: conversationKey(roomId, threadId), roomId, threadId })
  );

export const isComputerShown = async (
  sessionId: string,
  roomId: string,
  threadId: string | undefined
): Promise<boolean> => {
  const db = await openIndexDb(sessionId);
  try {
    return !!(await db.get('computerShown', conversationKey(roomId, threadId)));
  } finally {
    db.close();
  }
};
