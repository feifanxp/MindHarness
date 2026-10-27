// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultStore } from 'jotai';
import {
  DEFAULT_CROSS_ROOM_THREAD_FILTERS,
  clearCrossRoomThreadFiltersStore,
  makeCrossRoomThreadFiltersAtom,
  sanitizeCrossRoomThreadFilters,
} from '../crossRoomThreadFilters';

describe('crossRoomThreadFilters', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults unknown storage shapes', () => {
    expect(sanitizeCrossRoomThreadFilters(null)).toEqual(DEFAULT_CROSS_ROOM_THREAD_FILTERS);
    expect(sanitizeCrossRoomThreadFilters({ v: 2, query: 'ignored' })).toEqual(
      DEFAULT_CROSS_ROOM_THREAD_FILTERS
    );
  });

  it('sanitizes known fields and drops unknown values', () => {
    expect(
      sanitizeCrossRoomThreadFilters({
        v: 1,
        query: '  hello  ',
        scope: 'bad',
        roomIds: ['!a', '!a', 1, ''],
        spaceIds: ['!s'],
        tag: { include: ['urgent', 'urgent'], exclude: ['done'] },
        unreadOnly: true,
        resolved: 'unresolved',
        hasAttention: true,
        activityWindow: 'bad',
        ignored: true,
      })
    ).toEqual({
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      query: 'hello',
      roomIds: ['!a'],
      spaceIds: ['!s'],
      tag: { include: ['urgent'], exclude: ['done'] },
      unreadOnly: true,
      resolved: 'unresolved',
      hasAttention: true,
    });
  });

  it('persists structured filters under the bare per-user localStorage key and clears them', () => {
    const atom = makeCrossRoomThreadFiltersAtom('@me:example.org');
    const store = getDefaultStore();

    store.set(atom, {
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      query: 'agent',
      scope: 'all',
    });

    const stored = localStorage.getItem('crossRoomThreadFilters:@me:example.org');
    expect(stored).toContain('"scope":"all"');
    expect(stored).not.toContain('agent');
    expect(stored).not.toContain('"query"');

    clearCrossRoomThreadFiltersStore('@me:example.org');
    expect(localStorage.getItem('crossRoomThreadFilters:@me:example.org')).toBeNull();
  });

  it('keeps the in-memory query when a cross-tab storage event updates persisted filters', async () => {
    const userId = '@storage-query:example.org';
    const atom = makeCrossRoomThreadFiltersAtom(userId);
    const store = getDefaultStore();
    const unsubscribe = store.sub(atom, () => {});
    const storageKey = 'crossRoomThreadFilters:@storage-query:example.org';

    store.set(atom, {
      ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
      query: 'foo',
      scope: 'all',
    });

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ...DEFAULT_CROSS_ROOM_THREAD_FILTERS,
        query: 'bar',
        scope: 'involved',
        unreadOnly: true,
      })
    );
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    await Promise.resolve();

    expect(store.get(atom).query).toBe('foo');
    expect(store.get(atom).unreadOnly).toBe(true);

    unsubscribe();
    clearCrossRoomThreadFiltersStore(userId);
  });

  it('returns fresh ephemeral atoms while the user id is empty', () => {
    const firstAtom = makeCrossRoomThreadFiltersAtom('');
    const secondAtom = makeCrossRoomThreadFiltersAtom('');

    expect(firstAtom).not.toBe(secondAtom);
  });
});
