// CINNY-207 P2.2 commit 2 (F3): the beforeTokens map is now
// timestamped so the meta write path can prune the oldest entries
// while keeping the anchor being written. Entries are stored as
// `{ token, savedAt }`; the `getCachedPaginationToken` accessor still
// returns the raw `string | null | undefined` so callers don't change.

export type CachedPaginationTokenEntry = {
  token: string | null;
  savedAt: number;
};

export type CachedPaginationTokenMap = Record<string, CachedPaginationTokenEntry>;

export const resolveHydratedRoomBeforeToken = (
  cachedBeforeToken: string | null | undefined,
  paginationToken: string | null
): string | null => (cachedBeforeToken !== undefined ? cachedBeforeToken : paginationToken);

export type CachedPaginationAnchor = {
  eventId: string;
  ts: number;
};

// CINNY-207 P2.2 commit 2 / F3: cap on beforeTokens map size per meta
// record. The cursor only ever needs the token for the current earliest
// event id, plus a few historical anchors for prepend scenarios; 50
// entries is far above the working set and keeps meta rows bounded.
export const MAX_CACHE_BEFORE_TOKENS = 50;

/**
 * Merge a `{eventId → token}` update into an existing beforeTokens map
 * with pruning. On every write, if the resulting map would exceed
 * MAX_CACHE_BEFORE_TOKENS, evict the oldest entries by `savedAt`.
 *
 * The entry whose `eventId` matches the current earliest anchor being
 * written is NEVER pruned — it's the token the next paginate-before
 * call will look up.
 */
export const mergeCachedPaginationTokens = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined,
  beforeToken: string | null | undefined
): CachedPaginationTokenMap | undefined => {
  if (!eventId || beforeToken === undefined) return currentTokens;
  const now = Date.now();
  const merged: CachedPaginationTokenMap = {
    ...(currentTokens ?? {}),
    [eventId]: { token: beforeToken, savedAt: now },
  };
  return pruneCachedPaginationTokens(merged, eventId);
};

/**
 * Coerce a beforeTokens map value into the timestamped shape.
 *
 * CINNY-207 P2 review (defensive): the v3 DB has always written
 * `{token, savedAt}` — no shipped commit ever persisted a flat
 * `string | null` value. Still, if a caller (a hand-crafted seed, a
 * future migration, or a data-file replay) surfaces a flat entry, we
 * tolerate it rather than treating the token as missing. Flat entries
 * are treated as savedAt=0 so the prune path evicts them first.
 */
const normalizeTokenEntry = (
  value: CachedPaginationTokenEntry | string | null | undefined
): CachedPaginationTokenEntry | undefined => {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string') {
    return { token: value, savedAt: 0 };
  }
  return value;
};

/**
 * Cap the map to `MAX_CACHE_BEFORE_TOKENS` entries, evicting the oldest
 * by `savedAt`. `protectedEventId` (the earliest anchor being written
 * on this save) is retained even if it happens to be the oldest.
 */
export const pruneCachedPaginationTokens = (
  tokens: CachedPaginationTokenMap,
  protectedEventId: string
): CachedPaginationTokenMap => {
  const entries = Object.entries(tokens);
  if (entries.length <= MAX_CACHE_BEFORE_TOKENS) return tokens;

  // Normalize any legacy flat values (savedAt=0 makes them prunable-oldest).
  const normalizedEntries: Array<[string, CachedPaginationTokenEntry]> = entries.map(
    ([id, entry]) => [id, normalizeTokenEntry(entry) ?? { token: null, savedAt: 0 }]
  );

  // Sort oldest → newest by savedAt. Ties (equal savedAt from batched
  // writes) fall back to lexicographic event_id for deterministic
  // eviction across load orders.
  normalizedEntries.sort(([leftId, leftEntry], [rightId, rightEntry]) => {
    const diff = leftEntry.savedAt - rightEntry.savedAt;
    if (diff !== 0) return diff;
    return leftId.localeCompare(rightId);
  });

  // Peel off oldest until we're at the cap. Skip evicting the
  // protected id so we don't lose the anchor the current write needs.
  let toEvict = normalizedEntries.length - MAX_CACHE_BEFORE_TOKENS;
  const kept: CachedPaginationTokenMap = {};
  for (const [id, entry] of normalizedEntries) {
    if (toEvict > 0 && id !== protectedEventId) {
      toEvict -= 1;
      continue;
    }
    kept[id] = entry;
  }
  return kept;
};

export const getCachedPaginationToken = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined
): string | null | undefined => {
  if (!eventId) return undefined;
  // CINNY-207 P2 review (defensive): tolerate a legacy flat
  // `string | null` map value — see `normalizeTokenEntry`.
  const entry = normalizeTokenEntry(
    currentTokens?.[eventId] as CachedPaginationTokenEntry | string | null | undefined
  );
  return entry ? entry.token : undefined;
};

export const compareCachedPaginationAnchors = (
  left: CachedPaginationAnchor | undefined,
  right: CachedPaginationAnchor | undefined
): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const tsDiff = left.ts - right.ts;
  if (tsDiff !== 0) return tsDiff;
  return left.eventId.localeCompare(right.eventId);
};
