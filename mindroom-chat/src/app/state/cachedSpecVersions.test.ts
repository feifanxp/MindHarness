import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCacheOwnedLocalStorageKey } from '../utils/appOwnedStorage';
import {
  readCachedSpecVersions,
  removeCachedSpecVersions,
  writeCachedSpecVersions,
} from './cachedSpecVersions';

const storageState = new Map<string, string>();

describe('cachedSpecVersions', () => {
  beforeEach(() => {
    storageState.clear();
    vi.stubGlobal('localStorage', {
      get length() {
        return storageState.size;
      },
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storageState.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips versions in cache-owned localStorage', () => {
    const versions = {
      versions: ['v1.11'],
      unstable_features: { 'org.matrix.msc3916.stable': true },
    };

    writeCachedSpecVersions('https://matrix.example/', '@alice:example', versions);

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toEqual(versions);
    expect(Array.from(storageState.keys())).toEqual([
      'cinny_spec_versions::https://matrix.example::@alice:example',
    ]);
    expect(isCacheOwnedLocalStorageKey(Array.from(storageState.keys())[0])).toBe(true);
  });

  it('returns undefined for corrupt JSON', () => {
    storageState.set('cinny_spec_versions::https://matrix.example::@alice:example', '{not-json');

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toBeUndefined();
    expect(storageState.size).toBe(0);
  });

  it.each([
    ['an empty object', '{}'],
    ['a string', '"invalid"'],
    ['a non-array versions field', '{"versions":1}'],
    ['non-string versions', '{"versions":[1]}'],
    ['a non-object unstable_features field', '{"versions":["v1.11"],"unstable_features":[]}'],
    [
      'non-boolean unstable feature values',
      '{"versions":["v1.11"],"unstable_features":{"org.matrix.msc4151":"false"}}',
    ],
  ])('removes JSON-valid cache entries with %s', (_label, stored) => {
    storageState.set('cinny_spec_versions::https://matrix.example::@alice:example', stored);

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toBeUndefined();
    expect(storageState.size).toBe(0);
  });

  it('does not replace last-known-good versions with an empty response', () => {
    const versions = { versions: ['v1.11'] };
    writeCachedSpecVersions('https://matrix.example', '@alice:example', versions);

    writeCachedSpecVersions('https://matrix.example', '@alice:example', { versions: [] });

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toEqual(versions);
  });

  it('removes versions for one homeserver and user', () => {
    writeCachedSpecVersions('https://matrix.example', '@alice:example', {
      versions: ['v1.11'],
    });

    removeCachedSpecVersions('https://matrix.example/', '@alice:example');

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toBeUndefined();
  });

  it('isolates versions by homeserver and user', () => {
    const aliceVersions = { versions: ['v1.10'] };
    const bobVersions = { versions: ['v1.11'] };

    writeCachedSpecVersions('https://matrix.example', '@alice:example', aliceVersions);
    writeCachedSpecVersions('https://matrix.example', '@bob:example', bobVersions);

    expect(readCachedSpecVersions('https://matrix.example', '@alice:example')).toEqual(
      aliceVersions
    );
    expect(readCachedSpecVersions('https://matrix.example', '@bob:example')).toEqual(bobVersions);
    expect(readCachedSpecVersions('https://other.example', '@alice:example')).toBeUndefined();
  });
});
