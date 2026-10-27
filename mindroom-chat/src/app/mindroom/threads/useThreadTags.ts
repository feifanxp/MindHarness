import { useEffect, useMemo } from 'react';
import { Room } from 'matrix-js-sdk';
import { useStateEvents } from './useStateEvents';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import {
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  MINDROOM_THREAD_TAGS_EVENT,
  type TagMetadata,
  type ThreadTagsContent,
} from './threadTags';
import {
  clearPendingThreadTagsContent,
  getPendingThreadTagsContent,
  sameThreadTagsContent,
  usePendingThreadTagsVersion,
} from './threadTagPending';
import { buildThreadTagSnapshotMap } from './threadTagSnapshots';
import { usePinnedEventIds } from './useThreadPinning';

export type UseThreadTagsResult = {
  /** Full parsed tag map */
  tags: Record<string, TagMetadata>;
  /** Tag names excluding the reserved "resolved" tag */
  displayTags: string[];
  /** Whether the thread has the reserved "resolved" tag */
  isResolved: boolean;
  /** Whether the current user has permission to edit thread tags */
  canEdit: boolean;
  /** Tag names used across all threads in this room, minus current tags and "resolved" */
  availableTags: string[];
  /** The raw parsed content for use by mutation hooks */
  content: ThreadTagsContent;
};

const EMPTY_THREAD_TAGS: ThreadTagsContent = { tags: {} };

/**
 * Read hook for thread tags on a specific thread.
 *
 * Subscribes to all thread-tag state events in the room, then aggregates
 * legacy per-thread payloads with canonical per-tag records.
 */
export const useThreadTags = (
  room: Room,
  threadRootId: string | undefined
): UseThreadTagsResult => {
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  const allTagEvents = useStateEvents(room, MINDROOM_THREAD_TAGS_EVENT);
  const pinnedEventIds = usePinnedEventIds(room);
  const pVersion = usePendingThreadTagsVersion();

  const tagSnapshots = useMemo(() => buildThreadTagSnapshotMap(allTagEvents), [allTagEvents]);

  const actualContent = useMemo(
    () =>
      threadRootId
        ? tagSnapshots.get(threadRootId)?.content ?? EMPTY_THREAD_TAGS
        : EMPTY_THREAD_TAGS,
    [tagSnapshots, threadRootId]
  );
  const pendingContent = useMemo(
    () => (threadRootId ? getPendingThreadTagsContent(room.roomId, threadRootId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.roomId, threadRootId, pVersion]
  );
  const content = pendingContent ?? actualContent;

  useEffect(() => {
    if (!threadRootId || !pendingContent) return;
    if (sameThreadTagsContent(actualContent, pendingContent)) {
      clearPendingThreadTagsContent(room.roomId, threadRootId);
    }
  }, [actualContent, pendingContent, room.roomId, threadRootId]);

  const displayTags = useMemo(() => getDisplayTags(content), [content]);

  const resolved = isThreadResolved(content, pinnedEventIds.includes(threadRootId ?? ''));

  const canEdit = useMemo(
    () => permissions.stateEvent(MINDROOM_THREAD_TAGS_EVENT, mx.getSafeUserId()),
    [permissions, mx]
  );

  const allTagContents = useMemo(
    () => Array.from(tagSnapshots.values(), (snapshot) => snapshot.content),
    [tagSnapshots]
  );

  const availableTags = useMemo(
    () => collectAvailableTags(allTagContents, content.tags),
    [allTagContents, content.tags]
  );

  return {
    tags: content.tags,
    displayTags,
    isResolved: resolved,
    canEdit,
    availableTags,
    content,
  };
};
