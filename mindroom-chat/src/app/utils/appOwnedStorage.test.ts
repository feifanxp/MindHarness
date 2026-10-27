import { describe, expect, it, vi } from 'vitest';
import { clearAppOwnedCacheLocalStorage, isCacheOwnedLocalStorageKey } from './appOwnedStorage';

const createStorage = (entries: Record<string, string>) => {
  const state = new Map(Object.entries(entries));
  const storage = {
    get length() {
      return state.size;
    },
    key: (index: number) => Array.from(state.keys())[index] ?? null,
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => state.set(key, value),
    removeItem: vi.fn((key: string) => state.delete(key)),
    clear: vi.fn(),
  } as unknown as Storage;
  return { state, storage };
};

describe('app-owned localStorage', () => {
  it('recognizes cache keys without claiming durable preferences', () => {
    expect(isCacheOwnedLocalStorageKey('mx_pending_events_!room:example.org')).toBe(true);
    expect(isCacheOwnedLocalStorageKey('crypto.account')).toBe(false);
    expect(isCacheOwnedLocalStorageKey('settings')).toBe(false);
    expect(isCacheOwnedLocalStorageKey('roomViewMode:!room:example.org')).toBe(false);
    expect(isCacheOwnedLocalStorageKey('third_party_key')).toBe(false);
  });

  it('removes cache keys while preserving sessions, preferences, and unrelated origin data', () => {
    const { state, storage } = createStorage({
      settings: 'settings',
      i18nextLng: 'nl',
      voiceMessagePlaybackRate: '1.5',
      'roomViewMode:!room:example.org': 'compact',
      'roomThreadFilter:@alice:example.org:!room': 'filter',
      mindroom_multi_account_store: 'session',
      'mx_pending_events_!room:example.org': 'pending',
      'crypto.account': 'crypto',
      third_party_key: 'keep',
    });

    clearAppOwnedCacheLocalStorage(storage);

    expect(state).toEqual(
      new Map([
        ['settings', 'settings'],
        ['i18nextLng', 'nl'],
        ['voiceMessagePlaybackRate', '1.5'],
        ['roomViewMode:!room:example.org', 'compact'],
        ['roomThreadFilter:@alice:example.org:!room', 'filter'],
        ['mindroom_multi_account_store', 'session'],
        ['crypto.account', 'crypto'],
        ['third_party_key', 'keep'],
      ])
    );
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it('continues when removing one key throws', () => {
    const { state, storage } = createStorage({
      'mx_pending_events_!one:example.org': 'one',
      'mx_pending_events_!two:example.org': 'two',
    });
    storage.removeItem = vi.fn((key: string) => {
      if (key === 'mx_pending_events_!one:example.org') throw new Error('blocked');
      state.delete(key);
    });

    clearAppOwnedCacheLocalStorage(storage);

    expect(state.has('mx_pending_events_!one:example.org')).toBe(true);
    expect(state.has('mx_pending_events_!two:example.org')).toBe(false);
  });
});
