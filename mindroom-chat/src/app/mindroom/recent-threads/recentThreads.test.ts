import { createStore, getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bumpRecentThread,
  clearRecentThreadsStore,
  makeRecentThreadsAtom,
  registerRecentThreadsAtom,
  rekeyRecentThread,
} from './recentThreads';
import { setImperativeJotaiStore } from '../../state/jotaiStore';

const USER_ID = '@alice:example.org';

const createStorage = (): Storage => {
  const state = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      state.delete(key);
    }),
    clear: vi.fn(() => {
      state.clear();
    }),
    key: vi.fn(() => null),
    length: 0,
  };
};

describe('recentThreads', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorage(),
    });
  });

  afterEach(() => {
    clearRecentThreadsStore(USER_ID);
  });

  it('bumps an entry to the top and de-duplicates the same room/thread pair', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 100,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$newer',
      openedAt: 200,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 300,
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$older',
        openedAt: 300,
      },
      {
        roomId: '!room:example.org',
        threadId: '$newer',
        openedAt: 200,
      },
    ]);
  });

  it('ignores local-echo thread ids when bumping recent threads', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '~pending',
      openedAt: 100,
    });

    expect(store.get(recentThreadsAtom)).toEqual([]);
  });

  it('drops legacy local-echo thread ids from stored recent threads', () => {
    localStorage.setItem(
      'recentThreads:@alice:example.org',
      JSON.stringify({
        v: 1,
        entries: [
          {
            roomId: '!room:example.org',
            threadId: '~pending',
            openedAt: 200,
          },
          {
            roomId: '!room:example.org',
            threadId: '$confirmed',
            openedAt: 100,
          },
        ],
      })
    );

    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);

    expect(getDefaultStore().get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$confirmed',
        openedAt: 100,
      },
    ]);
  });

  it('rekeys reply ids to canonical roots without downgrading a newer canonical entry', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$root',
      openedAt: 200,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$other',
      openedAt: 150,
    });
    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$reply',
      openedAt: 100,
    });

    store.set(recentThreadsAtom, {
      type: 'REKEY',
      roomId: '!room:example.org',
      threadId: '$reply',
      nextThreadId: '$root',
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$root',
        openedAt: 200,
      },
      {
        roomId: '!room:example.org',
        threadId: '$other',
        openedAt: 150,
      },
    ]);
  });

  it('renames a stored reply id to the canonical root when no canonical entry exists yet', () => {
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const store = getDefaultStore();

    store.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$reply',
      openedAt: 125,
    });

    store.set(recentThreadsAtom, {
      type: 'REKEY',
      roomId: '!room:example.org',
      threadId: '$reply',
      nextThreadId: '$root',
    });

    expect(store.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$root',
        openedAt: 125,
      },
    ]);
  });

  it('does not rekey a recent thread to a local-echo id', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);
    const unregisterAtom = registerRecentThreadsAtom(USER_ID, recentThreadsAtom);

    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$confirmed',
      openedAt: 100,
    });

    rekeyRecentThread('!room:example.org', '$confirmed', '~pending');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$confirmed',
        openedAt: 100,
      },
    ]);

    unregisterAtom();
    unregisterStore();
  });

  it('writes imperative recent-thread bumps into the registered provider store', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);
    const unregisterAtom = registerRecentThreadsAtom(USER_ID, recentThreadsAtom);

    bumpRecentThread('!room:example.org', '$thread', 200, 'Preview text');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$thread',
        openedAt: 200,
        summaryText: 'Preview text',
      },
    ]);
    expect(getDefaultStore().get(recentThreadsAtom)).toEqual([]);

    unregisterAtom();
    unregisterStore();
  });

  it('updates a stored summary without changing recency order', () => {
    const providerStore = createStore();
    const recentThreadsAtom = makeRecentThreadsAtom(USER_ID);
    const unregisterStore = setImperativeJotaiStore(providerStore);
    const unregisterAtom = registerRecentThreadsAtom(USER_ID, recentThreadsAtom);

    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$older',
      openedAt: 100,
    });
    providerStore.set(recentThreadsAtom, {
      type: 'BUMP',
      roomId: '!room:example.org',
      threadId: '$newer',
      openedAt: 200,
    });

    bumpRecentThread('!room:example.org', '$older', 100, 'Stored preview');

    expect(providerStore.get(recentThreadsAtom)).toEqual([
      {
        roomId: '!room:example.org',
        threadId: '$newer',
        openedAt: 200,
      },
      {
        roomId: '!room:example.org',
        threadId: '$older',
        openedAt: 100,
        summaryText: 'Stored preview',
      },
    ]);

    unregisterAtom();
    unregisterStore();
  });
});
