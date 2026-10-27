import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserScopedAtomRegistry } from './userScopedAtomRegistry';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createUserScopedAtomRegistry', () => {
  it('keeps stable identities per user and can make empty-user atoms ephemeral', () => {
    const cached = createUserScopedAtomRegistry({
      create: (userId) => ({ userId }),
      getStorageKey: (userId) => `state:${userId}`,
    });
    const ephemeral = createUserScopedAtomRegistry({
      create: (userId) => ({ userId }),
      getStorageKey: (userId) => `ephemeral:${userId}`,
      cacheEmptyUserId: false,
    });

    expect(cached.getOrCreate('@alice')).toBe(cached.getOrCreate('@alice'));
    expect(cached.getOrCreate('@alice')).not.toBe(cached.getOrCreate('@bob'));
    expect(ephemeral.getOrCreate('')).not.toBe(ephemeral.getOrCreate(''));
  });

  it('keeps the newest registration active and makes cleanup identity-safe', () => {
    const registry = createUserScopedAtomRegistry({
      create: (userId) => ({ userId }),
      getStorageKey: (userId) => `state:${userId}`,
    });
    const alice = registry.getOrCreate('@alice');
    const bob = registry.getOrCreate('@bob');
    const unregisterAlice = registry.registerActive('@alice', alice);
    const unregisterBob = registry.registerActive('@bob', bob);

    unregisterAlice();
    expect(registry.resolveActiveOrCreate('@bob')).toBe(bob);

    // An active registration from the previous account must never win over
    // the account requested by an imperative caller during a client switch.
    expect(registry.resolveActiveOrCreate('@alice')).toBe(alice);

    unregisterBob();
    expect(registry.resolveActiveOrCreate(undefined)).toBeUndefined();
    expect(registry.resolveActiveOrCreate('@alice')).toBe(alice);
  });

  it('clears the cached identity, active registration, and storage key together', () => {
    const registry = createUserScopedAtomRegistry({
      create: (userId) => ({ userId }),
      getStorageKey: (userId) => `state:${userId}`,
    });
    const before = registry.getOrCreate('@alice');
    registry.registerActive('@alice', before);
    storage.set('state:@alice', 'value');

    registry.clear('@alice');

    expect(storage.has('state:@alice')).toBe(false);
    expect(registry.resolveActiveOrCreate(undefined)).toBeUndefined();
    expect(registry.getOrCreate('@alice')).not.toBe(before);
  });

  it('forgets in-memory state even when best-effort storage cleanup is blocked', () => {
    const registry = createUserScopedAtomRegistry({
      create: (userId) => ({ userId }),
      getStorageKey: (userId) => `state:${userId}`,
    });
    const before = registry.getOrCreate('@alice');
    storage.set('state:@alice', 'value');
    vi.mocked(globalThis.localStorage.removeItem).mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    registry.clear('@alice');
    expect(storage.get('state:@alice')).toBe('value');
    expect(registry.getOrCreate('@alice')).not.toBe(before);
  });
});
