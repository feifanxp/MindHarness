import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

/**
 * Thread tag types, parsers, and builders for `com.mindroom.thread.tags` room state.
 *
 * Supported read formats:
 * - Legacy per-thread state: `state_key = "$threadRootId"`, `content = { tags: { ... } }`
 * - Canonical per-tag state: `state_key = "[\"$threadRootId\",\"tag\"]"`, `content = { ... }`
 *
 * All writes should use the canonical per-tag format.
 */

export const MINDROOM_THREAD_TAGS_EVENT = 'com.mindroom.thread.tags';
export const RESOLVED_TAG = 'resolved';
export const MAX_TAG_LENGTH = 50;
const PERSISTED_TAG_NAME = /^[a-z0-9-]{1,50}$/;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const aggregatedThreadTagEventsCache = new WeakMap<MatrixEvent[], Map<string, ThreadTagsContent>>();

export type TagMetadata = {
  set_by: string;
  set_at: string;
  note?: string;
  data?: Record<string, unknown>;
};

export type ThreadTagsContent = {
  tags: Record<string, TagMetadata>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizePersistedTagName = (value: unknown): string | undefined => {
  const normalized = normalizeNonEmptyString(value)?.toLowerCase();
  if (!normalized || !PERSISTED_TAG_NAME.test(normalized)) {
    return undefined;
  }
  return normalized;
};

const requirePersistedTagName = (value: string): string => {
  const normalized = normalizePersistedTagName(value);
  if (!normalized) {
    throw new Error(`Invalid thread tag name: ${value}`);
  }
  return normalized;
};

export const normalizeSetAt = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;

    const normalized = date.toISOString();
    return ISO_8601_PATTERN.test(normalized) ? normalized : undefined;
  }

  if (
    typeof value !== 'string' ||
    !ISO_8601_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return undefined;
  }

  return value;
};

const normalizeNote = (value: unknown): string | undefined | null => {
  if (value == null) return undefined;
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeData = (value: unknown): Record<string, unknown> | undefined | null => {
  if (value == null) return undefined;
  if (!isRecord(value)) return null;

  return { ...value };
};

const parseTagMetadata = (value: unknown): TagMetadata | null => {
  if (!isRecord(value)) return null;

  const setBy = normalizeNonEmptyString(value.set_by);
  const setAt = normalizeSetAt(value.set_at);
  const note = normalizeNote(value.note);
  const data = normalizeData(value.data);
  if (!setBy || !setAt || note === null || data === null) {
    return null;
  }

  return {
    set_by: setBy,
    set_at: setAt,
    ...(note !== undefined ? { note } : {}),
    ...(data !== undefined ? { data } : {}),
  };
};

const sortTags = (tags: Record<string, TagMetadata>): Record<string, TagMetadata> =>
  Object.fromEntries(Object.entries(tags).sort(([left], [right]) => left.localeCompare(right)));

/**
 * Parse raw state event content into a typed ThreadTagsContent.
 * Returns empty tags for invalid or missing content.
 */
export const parseThreadTagsContent = (content: unknown): ThreadTagsContent => {
  if (!isRecord(content) || !isRecord(content.tags)) {
    return { tags: {} };
  }

  const parsedTags: Record<string, TagMetadata> = {};
  Object.entries(content.tags).forEach(([tagName, value]) => {
    const normalizedTagName = normalizePersistedTagName(tagName);
    const metadata = parseTagMetadata(value);
    if (!normalizedTagName || !metadata) {
      return;
    }

    parsedTags[normalizedTagName] = metadata;
  });

  return { tags: parsedTags };
};

/**
 * Check whether thread tags content represents a tombstoned / empty state.
 */
export const isThreadTagsTombstone = (content: unknown): boolean => {
  const parsed = parseThreadTagsContent(content);
  return Object.keys(parsed.tags).length === 0;
};

/**
 * Build content that adds a tag while preserving existing tags.
 */
export const buildAddTagContent = (
  existing: ThreadTagsContent,
  tagName: string,
  userId: string,
  setAt = new Date().toISOString()
): ThreadTagsContent => ({
  tags: {
    ...existing.tags,
    [requirePersistedTagName(tagName)]: { set_by: userId, set_at: setAt },
  },
});

/**
 * Build content that removes a tag while preserving others.
 */
export const buildRemoveTagContent = (
  existing: ThreadTagsContent,
  tagName: string
): ThreadTagsContent => {
  const next = { ...existing.tags };
  delete next[requirePersistedTagName(tagName)];
  return { tags: next };
};

/**
 * Build content that sets the thread as resolved, preserving existing tags.
 */
export const buildResolvedTagsContent = (
  existing: ThreadTagsContent,
  userId: string
): ThreadTagsContent => buildAddTagContent(existing, RESOLVED_TAG, userId);

/**
 * Build content that removes the resolved tag, preserving other tags.
 */
export const buildUnresolvedTagsContent = (existing: ThreadTagsContent): ThreadTagsContent =>
  buildRemoveTagContent(existing, RESOLVED_TAG);

/**
 * Parse a canonical per-tag state key: `["$threadRootId","tag"]`.
 */
export const parsePerTagStateKey = (
  stateKey: string
): { threadRootId: string; tagName: string } | null => {
  try {
    const parsed = JSON.parse(stateKey);
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return null;
    }

    const threadRootId = normalizeNonEmptyString(parsed[0]);
    const tagName = normalizePersistedTagName(parsed[1]);
    if (!threadRootId || !threadRootId.startsWith('$') || !tagName) {
      return null;
    }

    return { threadRootId, tagName };
  } catch {
    return null;
  }
};

/**
 * Build a canonical per-tag state key with compact JSON formatting.
 */
export const buildPerTagStateKey = (threadRootId: string, tagName: string): string =>
  JSON.stringify([threadRootId, requirePersistedTagName(tagName)]);

/**
 * Parse flat per-tag event content into TagMetadata.
 * Empty content is treated as a tombstone and returns null.
 */
export const parsePerTagContent = (content: unknown): TagMetadata | null => {
  if (!isRecord(content) || Object.keys(content).length === 0) {
    return null;
  }

  return parseTagMetadata(content);
};

/**
 * Build flat wire content for one canonical per-tag state event.
 */
export const buildPerTagEventContent = (
  userId: string,
  note?: string,
  data?: Record<string, unknown>,
  setAt = new Date().toISOString()
): Record<string, unknown> => {
  const normalizedNote = normalizeNote(note);
  const normalizedData = normalizeData(data);

  return {
    set_by: userId,
    set_at: setAt,
    ...(normalizedNote !== undefined ? { note: normalizedNote } : {}),
    ...(normalizedData !== undefined ? { data: normalizedData } : {}),
  };
};

/**
 * Merge legacy per-thread events with canonical per-tag records for one room.
 * Per-tag tombstones remove legacy tags, and per-tag records override legacy data.
 */
export const aggregateThreadTagEvents = (events: MatrixEvent[]): Map<string, ThreadTagsContent> => {
  const cached = aggregatedThreadTagEventsCache.get(events);
  if (cached) {
    return cached;
  }

  const legacyTagsByThread = new Map<string, Record<string, TagMetadata>>();
  const perTagRecordsByThread = new Map<string, Record<string, TagMetadata>>();
  const perTagTombstonesByThread = new Map<string, Set<string>>();

  events.forEach((event) => {
    const stateKey = event.getStateKey();
    if (typeof stateKey !== 'string') {
      return;
    }

    const parsedStateKey = parsePerTagStateKey(stateKey);
    if (parsedStateKey === null) {
      const legacyState = parseThreadTagsContent(event.getContent());
      if (Object.keys(legacyState.tags).length > 0) {
        legacyTagsByThread.set(stateKey, legacyState.tags);
      }
      return;
    }

    const { threadRootId, tagName } = parsedStateKey;
    const content = event.getContent();

    if (isRecord(content) && Object.keys(content).length === 0) {
      const tombstones = perTagTombstonesByThread.get(threadRootId) ?? new Set<string>();
      tombstones.add(tagName);
      perTagTombstonesByThread.set(threadRootId, tombstones);
      return;
    }

    const record = parsePerTagContent(content);
    if (!record) {
      return;
    }

    const threadRecords = perTagRecordsByThread.get(threadRootId) ?? {};
    threadRecords[tagName] = record;
    perTagRecordsByThread.set(threadRootId, threadRecords);
  });

  const mergedThreadRootIds = new Set<string>([
    ...legacyTagsByThread.keys(),
    ...perTagRecordsByThread.keys(),
    ...perTagTombstonesByThread.keys(),
  ]);

  const aggregated = new Map<string, ThreadTagsContent>();
  Array.from(mergedThreadRootIds)
    .sort()
    .forEach((threadRootId) => {
      const mergedTags = { ...(legacyTagsByThread.get(threadRootId) ?? {}) };

      perTagTombstonesByThread.get(threadRootId)?.forEach((tagName) => {
        delete mergedTags[tagName];
      });

      Object.assign(mergedTags, perTagRecordsByThread.get(threadRootId));

      if (Object.keys(mergedTags).length > 0) {
        aggregated.set(threadRootId, { tags: sortTags(mergedTags) });
      }
    });

  aggregatedThreadTagEventsCache.set(events, aggregated);
  return aggregated;
};

/**
 * Get display tags (all tags except the reserved "resolved" tag).
 */
export const getDisplayTags = (content: ThreadTagsContent): string[] =>
  Object.keys(content.tags).filter((name) => name !== RESOLVED_TAG);

/**
 * Check if a thread is resolved.
 */
export const isThreadResolved = (content: ThreadTagsContent, pinned = false): boolean =>
  !pinned && RESOLVED_TAG in content.tags;

/**
 * Collect unique tag names from multiple thread tag events, excluding "resolved".
 */
export const collectAvailableTags = (
  allTagContents: ThreadTagsContent[],
  currentTags: Record<string, TagMetadata>
): string[] => {
  const seen = new Set<string>();
  allTagContents.forEach((content) => {
    Object.keys(content.tags).forEach((name) => {
      if (name !== RESOLVED_TAG && !(name in currentTags)) {
        seen.add(name);
      }
    });
  });
  return Array.from(seen).sort();
};

/**
 * Normalize a tag name: trim whitespace and lowercase.
 */
export const normalizeTagName = (input: string): string => input.trim().toLowerCase();

/**
 * Validate a tag name. Returns true if the name is valid for use.
 */
export const isValidTagName = (name: string): boolean => {
  const normalized = normalizeTagName(name);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_TAG_LENGTH &&
    normalized !== RESOLVED_TAG &&
    PERSISTED_TAG_NAME.test(normalized)
  );
};
