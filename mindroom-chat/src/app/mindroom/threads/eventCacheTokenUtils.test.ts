/**
 * Tokens map basics + CINNY-207 P2.2 commit 2 (F3) pruning.
 *
 * The map shape is now `{ eventId: { token, savedAt } }` so meta writes
 * can cap growth per meta record while retaining the newest entries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CACHE_BEFORE_TOKENS,
  compareCachedPaginationAnchors,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
  pruneCachedPaginationTokens,
  type CachedPaginationTokenMap,
} from './eventCacheTokenUtils';

const buildMap = (
  entries: Array<[string, string | null, number]>
): CachedPaginationTokenMap =>
  Object.fromEntries(
    entries.map(([id, token, savedAt]) => [id, { token, savedAt }])
  );

describe('mergeCachedPaginationTokens', () => {
  afterEach(() => vi.useRealTimers());

  it('adds a token mapping for a known earliest event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(12345);
    expect(mergeCachedPaginationTokens(undefined, '$event', 'token')).toEqual({
      $event: { token: 'token', savedAt: 12345 },
    });
  });

  it('preserves existing mappings when adding a new one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(200);
    const seeded = buildMap([['$old', 'old-token', 100]]);
    expect(mergeCachedPaginationTokens(seeded, '$event', null)).toEqual({
      $old: { token: 'old-token', savedAt: 100 },
      $event: { token: null, savedAt: 200 },
    });
  });

  it('returns the current map when no token update is provided', () => {
    const seeded = buildMap([['$old', 'old-token', 100]]);
    expect(mergeCachedPaginationTokens(seeded, '$event', undefined)).toBe(seeded);
  });

  it('overwrites a stale string token with null when server reports no more pages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(500);
    const seeded = buildMap([['$event', 'stale-token', 100]]);
    expect(mergeCachedPaginationTokens(seeded, '$event', null)).toEqual({
      $event: { token: null, savedAt: 500 },
    });
  });
});

describe('getCachedPaginationToken', () => {
  it('returns the stored token for an event', () => {
    expect(
      getCachedPaginationToken(buildMap([['$event', 'token', 100]]), '$event')
    ).toBe('token');
  });

  it('returns null for explicitly cleared tokens (no more pages)', () => {
    expect(
      getCachedPaginationToken(buildMap([['$event', null, 100]]), '$event')
    ).toBeNull();
  });

  it('returns undefined for unknown events (no cache data)', () => {
    expect(
      getCachedPaginationToken(buildMap([['$event', 'token', 100]]), '$other')
    ).toBeUndefined();
    expect(getCachedPaginationToken(undefined, '$event')).toBeUndefined();
  });
});

describe('compareCachedPaginationAnchors', () => {
  it('orders anchors by timestamp before event id', () => {
    expect(
      compareCachedPaginationAnchors(
        { eventId: '$b', ts: 200 },
        { eventId: '$a', ts: 100 }
      )
    ).toBeGreaterThan(0);
    expect(
      compareCachedPaginationAnchors(
        { eventId: '$b', ts: 200 },
        { eventId: '$c', ts: 200 }
      )
    ).toBeLessThan(0);
  });

  it('handles missing anchors deterministically', () => {
    expect(compareCachedPaginationAnchors(undefined, { eventId: '$a', ts: 100 })).toBeLessThan(0);
    expect(compareCachedPaginationAnchors({ eventId: '$a', ts: 100 }, undefined)).toBeGreaterThan(0);
    expect(compareCachedPaginationAnchors(undefined, undefined)).toBe(0);
  });
});

// CINNY-207 P2.2 commit 2 (F3): pruning.
describe('CINNY-207 P2.2 (F3): beforeTokens pruning', () => {
  afterEach(() => vi.useRealTimers());

  it('exposes MAX_CACHE_BEFORE_TOKENS = 50', () => {
    expect(MAX_CACHE_BEFORE_TOKENS).toBe(50);
  });

  it('caps map growth at MAX_CACHE_BEFORE_TOKENS entries across repeated merges', () => {
    vi.useFakeTimers();
    let map: CachedPaginationTokenMap | undefined;
    for (let i = 0; i < 60; i += 1) {
      vi.setSystemTime(1_000_000 + i);
      map = mergeCachedPaginationTokens(map, `$evt-${i}`, `token-${i}`);
    }
    expect(Object.keys(map ?? {}).length).toBe(MAX_CACHE_BEFORE_TOKENS);
  });

  it('retains the newest entries when pruning', () => {
    vi.useFakeTimers();
    let map: CachedPaginationTokenMap | undefined;
    for (let i = 0; i < 60; i += 1) {
      vi.setSystemTime(1_000_000 + i);
      map = mergeCachedPaginationTokens(map, `$evt-${i}`, `token-${i}`);
    }
    // The 50 newest (i = 10..59) survive; oldest 10 are evicted.
    for (let i = 10; i < 60; i += 1) {
      expect(map?.[`$evt-${i}`]?.token).toBe(`token-${i}`);
    }
    for (let i = 0; i < 10; i += 1) {
      expect(map?.[`$evt-${i}`]).toBeUndefined();
    }
  });

  it('never prunes the entry being written (protected id survives even if oldest)', () => {
    const entries: Array<[string, string | null, number]> = [];
    for (let i = 0; i < 60; i += 1) {
      entries.push([`$evt-${i}`, `token-${i}`, 1_000_000 + i]);
    }
    const seeded = buildMap(entries);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // Same savedAt as the oldest ($evt-0).
    const merged = mergeCachedPaginationTokens(seeded, '$evt-0', 'token-0-refresh');
    expect(Object.keys(merged ?? {}).length).toBe(MAX_CACHE_BEFORE_TOKENS);
    // Protected id (the anchor being written) MUST survive.
    expect(merged?.['$evt-0']?.token).toBe('token-0-refresh');
  });

  it('pruneCachedPaginationTokens is a no-op at or below the cap', () => {
    const entries: Array<[string, string | null, number]> = [];
    for (let i = 0; i < MAX_CACHE_BEFORE_TOKENS; i += 1) {
      entries.push([`$evt-${i}`, `token-${i}`, 1_000_000 + i]);
    }
    const seeded = buildMap(entries);
    const pruned = pruneCachedPaginationTokens(seeded, '$evt-0');
    expect(pruned).toBe(seeded);
  });

  it('overwriting an existing id refreshes savedAt for prune ordering', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    let map = mergeCachedPaginationTokens(undefined, '$a', 'token-a-v1');
    vi.setSystemTime(2_000_000);
    map = mergeCachedPaginationTokens(map, '$a', 'token-a-v2');
    expect(map?.$a?.savedAt).toBe(2_000_000);
    expect(map?.$a?.token).toBe('token-a-v2');
  });

  it('breaks equal-savedAt ties lexicographically for deterministic eviction', () => {
    const entries: Array<[string, string | null, number]> = [];
    for (let i = 0; i < 60; i += 1) {
      // Zero-padded so lexicographic and numeric order agree.
      const id = `$evt-${i.toString().padStart(3, '0')}`;
      entries.push([id, `token-${i}`, 1_500_000]);
    }
    const seeded = buildMap(entries);
    const pruned = pruneCachedPaginationTokens(seeded, '$evt-000');
    // Protected id survives.
    expect(pruned['$evt-000']).toBeDefined();
    // Lexicographically-earliest ids ($evt-001..$evt-010) are evicted.
    for (let i = 1; i <= 10; i += 1) {
      const id = `$evt-${i.toString().padStart(3, '0')}`;
      expect(pruned[id]).toBeUndefined();
    }
    // $evt-011..$evt-059 survive.
    for (let i = 11; i < 60; i += 1) {
      const id = `$evt-${i.toString().padStart(3, '0')}`;
      expect(pruned[id]).toBeDefined();
    }
  });
});

// CINNY-207 P2 review (defensive): a legacy flat `string | null` value
// in the beforeTokens map must still surface via `getCachedPaginationToken`
// (rather than reading as missing) and must be treated as prunable-oldest.
describe('CINNY-207 P2 review: flat-token map value compatibility', () => {
  it('getCachedPaginationToken returns the token when the map value is a bare string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyMap = { $event: 'legacy-flat-token' } as any;
    expect(getCachedPaginationToken(legacyMap, '$event')).toBe('legacy-flat-token');
  });

  it('getCachedPaginationToken returns null when the map value is bare null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyMap = { $event: null } as any;
    expect(getCachedPaginationToken(legacyMap, '$event')).toBeNull();
  });

  it('prune treats a flat entry as savedAt=0 so it is evicted before timestamped entries', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mixed: any = {
      $legacy: 'legacy-flat',
    };
    for (let i = 0; i < MAX_CACHE_BEFORE_TOKENS; i += 1) {
      mixed[`$evt-${i}`] = { token: `token-${i}`, savedAt: 1_000_000 + i };
    }
    const pruned = pruneCachedPaginationTokens(mixed, '$evt-0');
    // Total is MAX+1, prune removes 1 — the oldest, which is the flat legacy entry.
    expect(pruned.$legacy).toBeUndefined();
    // All timestamped entries survive.
    for (let i = 0; i < MAX_CACHE_BEFORE_TOKENS; i += 1) {
      expect(pruned[`$evt-${i}`]).toBeDefined();
    }
  });
});
