/**
 * CINNY-207 P3.2: tail-discontinuity markers on the room-timeline
 * meta row.
 *
 * When the SDK reports a limited sync (RoomEvent.TimelineReset on the
 * room's unfiltered timelineSet), events between our last sync token
 * and the server's current state may have been dropped. We can't fetch
 * them from RoomEvent.Timeline because the SDK never fired for them.
 * The engine's gap tracker records the fact into the cache so the
 * Phase 4 backfill scheduler can execute a fill for the room later —
 * this module owns the read/write of that marker.
 *
 * The marker lives on the room-timeline meta row (roomId, scope=='')
 * as an optional additive field (`tailDiscontinuity`), so the schema
 * version does not change and older readers ignore it.
 */

import { readMetaRecord, updateMetaRecord } from './cacheStoreMeta';
import { buildMetaKey, ROOM_SCOPE, type CachedMetaRecord } from './cacheStoreSchema';

export type TailDiscontinuityMarker = NonNullable<CachedMetaRecord['tailDiscontinuity']>;

export const getTailDiscontinuityGeneration = (
  marker: Pick<TailDiscontinuityMarker, 'markedAt' | 'prevBatch' | 'generation'>
): string => marker.generation ?? `${marker.markedAt}:${marker.prevBatch ?? ''}`;

/**
 * Mark the room's tail as discontinuous. Idempotent — the newer
 * `markedAt` wins. If no meta row exists yet, a minimal one is
 * created (all optional fields undefined) so the marker survives.
 */
export const markRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  marker: TailDiscontinuityMarker
): Promise<TailDiscontinuityMarker> => {
  const durableMarker = await updateMetaRecord(sessionId, roomId, ROOM_SCOPE, (existing, store) => {
    const existingMarker = existing?.tailDiscontinuity;
    if (existingMarker && existingMarker.markedAt > marker.markedAt) {
      return existingMarker;
    }
    // A newer reset supersedes the cursor, but both resets still belong to
    // the same unfinished gap. Keep the original pre-gap boundary so pages
    // written by an older in-flight fill cannot become a false completion
    // boundary for its successor. An empty array is also meaningful: it
    // records that no cached boundary existed when the gap was first seen.
    const nextMarker =
      existingMarker?.overlapEventIds === undefined
        ? marker
        : { ...marker, overlapEventIds: [...existingMarker.overlapEventIds] };
    const nextMeta: CachedMetaRecord = existing
      ? { ...existing, tailDiscontinuity: nextMarker, updatedAt: Date.now() }
      : {
          metaKey: buildMetaKey(roomId, ROOM_SCOPE),
          roomId,
          scope: ROOM_SCOPE,
          updatedAt: Date.now(),
          tailDiscontinuity: nextMarker,
        };
    store.put(nextMeta);
    return nextMarker;
  });

  if (!durableMarker) throw new Error('Tail-discontinuity marker was not committed.');
  return durableMarker;
};

/**
 * Clear the room's tail-discontinuity marker. Called by the Phase 4
 * gap-fill executor after a successful fill. No-op if no marker or
 * no meta row exists. Reports whether the room is clear after the commit.
 */
export const clearRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  expectedGeneration?: string
): Promise<boolean> => {
  return updateMetaRecord(sessionId, roomId, ROOM_SCOPE, (existing, store) => {
    if (!existing?.tailDiscontinuity) return true;
    if (
      expectedGeneration &&
      getTailDiscontinuityGeneration(existing.tailDiscontinuity) !== expectedGeneration
    ) {
      return false;
    }
    const { tailDiscontinuity: _drop, ...rest } = existing;
    store.put({ ...rest, updatedAt: Date.now() } satisfies CachedMetaRecord);
    return true;
  });
};

/** Advance a marker only when it still belongs to the running generation. */
export const checkpointRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string,
  expectedGeneration: string,
  nextToken: string | null,
  overlapEventIds?: readonly string[]
): Promise<boolean> => {
  try {
    return await updateMetaRecord(sessionId, roomId, ROOM_SCOPE, (existing, store) => {
      const marker = existing?.tailDiscontinuity;
      if (!existing || !marker) return false;
      if (getTailDiscontinuityGeneration(marker) !== expectedGeneration) return false;
      store.put({
        ...existing,
        updatedAt: Date.now(),
        tailDiscontinuity: {
          ...marker,
          generation: expectedGeneration,
          nextToken,
          ...(overlapEventIds === undefined ? {} : { overlapEventIds: [...overlapEventIds] }),
        },
      } satisfies CachedMetaRecord);
      return true;
    });
  } catch {
    return false;
  }
};

/**
 * Read the marker for a room. Returns `undefined` when the row or the
 * marker is absent. Used by the gap-fill executor and by tests.
 */
export const loadRoomTailDiscontinuity = async (
  sessionId: string,
  roomId: string
): Promise<TailDiscontinuityMarker | undefined> => {
  const existing = await readMetaRecord(sessionId, roomId, ROOM_SCOPE);
  return existing?.tailDiscontinuity;
};
