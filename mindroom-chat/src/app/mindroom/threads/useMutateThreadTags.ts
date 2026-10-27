import { useCallback, useRef, useState } from 'react';
import { EventTimeline, Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  buildAddTagContent,
  buildPerTagEventContent,
  buildPerTagStateKey,
  buildRemoveTagContent,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';
import { clearPendingThreadTagsContent, setPendingThreadTagsContent } from './threadTagPending';
import { buildThreadTagSnapshotMap } from './threadTagSnapshots';
import { getResolvableThreadRootEvent } from './threadResolvableRoot';
import { isThreadPinned } from './threadPinning';

type ThreadRootEventResolver = typeof getValidThreadRootEvent;

export type UseMutateThreadTagsResult = {
  addTag: (threadRootId: string, tagName: string) => Promise<void>;
  removeTag: (threadRootId: string, tagName: string) => Promise<void>;
  setResolved: (threadRootId: string, resolved: boolean) => Promise<void>;
  updating: boolean;
  updatingThreadRootIds: ReadonlySet<string>;
  error: Error | null;
};

/**
 * Read live state directly from the room timeline.
 * Uses EventTimeline.FORWARDS (not the string 'forward') per CINNY-047 fix.
 */
const readLiveTagsContent = (room: Room, threadRootId: string) => {
  const stateEvents = room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT);

  if (!Array.isArray(stateEvents)) {
    return { tags: {} };
  }

  return buildThreadTagSnapshotMap(stateEvents).get(threadRootId)?.content ?? { tags: {} };
};

/**
 * Write hook for thread tag mutations.
 *
 * All write operations:
 * 1. Re-read live state from EventTimeline.FORWARDS (not cache)
 * 2. Build the next aggregated thread content plus the canonical per-tag write
 * 3. Send via mx.sendStateEvent with a JSON-array per-tag state key
 */
export const useMutateThreadTags = (room: Room): UseMutateThreadTagsResult => {
  const mx = useMatrixClient();
  const [updatingThreadRootIds, setUpdatingThreadRootIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef(new Set<string>());

  const sendUpdate = useCallback(
    async (
      threadRootId: string,
      buildPlan: (
        existing: ThreadTagsContent,
        validThreadRootId: string,
        userId: string,
        setAt: string
      ) => {
        next: ThreadTagsContent;
        stateKey: string;
        eventContent: Record<string, unknown>;
      },
      resolveThreadRootEvent: ThreadRootEventResolver = getResolvableThreadRootEvent
    ) => {
      if (pendingRef.current.has(threadRootId)) return;
      pendingRef.current.add(threadRootId);
      setUpdatingThreadRootIds(new Set(pendingRef.current));
      setError(null);
      try {
        const userId = mx.getSafeUserId();
        const validThreadRootId = resolveThreadRootEvent(room, threadRootId)?.getId();
        if (!validThreadRootId) {
          throw new Error('Thread tags are only available for known thread roots.');
        }

        const current = readLiveTagsContent(room, validThreadRootId);
        const setAt = new Date().toISOString();
        const { next, stateKey, eventContent } = buildPlan(
          current,
          validThreadRootId,
          userId,
          setAt
        );
        if (
          stateKey === buildPerTagStateKey(validThreadRootId, RESOLVED_TAG) &&
          isThreadPinned(room, validThreadRootId)
        ) {
          throw new Error('Pinned threads cannot be resolved.');
        }
        setPendingThreadTagsContent(room.roomId, validThreadRootId, next);
        await mx.sendStateEvent(
          room.roomId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          MINDROOM_THREAD_TAGS_EVENT as any,
          eventContent,
          stateKey
        );
      } catch (err) {
        const validThreadRootId = resolveThreadRootEvent(room, threadRootId)?.getId();
        if (validThreadRootId) {
          clearPendingThreadTagsContent(room.roomId, validThreadRootId);
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        pendingRef.current.delete(threadRootId);
        setUpdatingThreadRootIds(new Set(pendingRef.current));
      }
    },
    [mx, room]
  );

  const addTag = useCallback(
    (threadRootId: string, tagName: string) =>
      sendUpdate(threadRootId, (existing, validThreadRootId, userId, setAt) => ({
        next: buildAddTagContent(existing, tagName, userId, setAt),
        stateKey: buildPerTagStateKey(validThreadRootId, tagName),
        eventContent: buildPerTagEventContent(userId, undefined, undefined, setAt),
      })),
    [sendUpdate]
  );

  const removeTag = useCallback(
    (threadRootId: string, tagName: string) =>
      sendUpdate(threadRootId, (existing, validThreadRootId) => ({
        next: buildRemoveTagContent(existing, tagName),
        stateKey: buildPerTagStateKey(validThreadRootId, tagName),
        eventContent: {},
      })),
    [sendUpdate]
  );

  const setResolved = useCallback(
    (threadRootId: string, resolved: boolean) =>
      sendUpdate(
        threadRootId,
        (existing, validThreadRootId, userId, setAt) => ({
          next: resolved
            ? buildAddTagContent(existing, RESOLVED_TAG, userId, setAt)
            : buildRemoveTagContent(existing, RESOLVED_TAG),
          stateKey: buildPerTagStateKey(validThreadRootId, RESOLVED_TAG),
          eventContent: resolved
            ? buildPerTagEventContent(userId, undefined, undefined, setAt)
            : {},
        }),
        getResolvableThreadRootEvent
      ),
    [sendUpdate]
  );

  return {
    addTag,
    removeTag,
    setResolved,
    updating: updatingThreadRootIds.size > 0,
    updatingThreadRootIds,
    error,
  };
};
