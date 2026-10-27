import { useSyncExternalStore } from 'react';
import type { ThreadTagsContent } from './threadTags';

const PENDING_TIMEOUT_MS = 15000;

const pendingTags = new Map<string, ThreadTagsContent>();
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const pendingListeners = new Set<() => void>();
let pendingVersion = 0;

const pendingKey = (roomId: string, threadRootId: string): string =>
  `${roomId}\0${threadRootId}`;

const emitPendingChange = () => {
  pendingVersion += 1;
  pendingListeners.forEach((listener) => listener());
};

const clearPendingTimeout = (key: string) => {
  const timeout = pendingTimeouts.get(key);
  if (timeout !== undefined) {
    clearTimeout(timeout);
    pendingTimeouts.delete(key);
  }
};

const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

const getPendingVersion = () => pendingVersion;

export const usePendingThreadTagsVersion = () =>
  useSyncExternalStore(subscribePending, getPendingVersion, getPendingVersion);

export const setPendingThreadTagsContent = (
  roomId: string,
  threadRootId: string,
  content: ThreadTagsContent
) => {
  const key = pendingKey(roomId, threadRootId);
  clearPendingTimeout(key);
  pendingTags.set(key, content);
  pendingTimeouts.set(
    key,
    setTimeout(() => {
      clearPendingThreadTagsContent(roomId, threadRootId);
    }, PENDING_TIMEOUT_MS)
  );
  emitPendingChange();
};

export const clearPendingThreadTagsContent = (roomId: string, threadRootId: string) => {
  const key = pendingKey(roomId, threadRootId);
  const had = pendingTags.delete(key);
  clearPendingTimeout(key);
  if (had) emitPendingChange();
};

export const getPendingThreadTagsContent = (
  roomId: string,
  threadRootId: string
): ThreadTagsContent | undefined => pendingTags.get(pendingKey(roomId, threadRootId));

export const getPendingThreadTagsContentMap = (roomId: string): Map<string, ThreadTagsContent> => {
  const prefix = `${roomId}\0`;
  const result = new Map<string, ThreadTagsContent>();
  pendingTags.forEach((content, key) => {
    if (key.startsWith(prefix)) {
      result.set(key.slice(prefix.length), content);
    }
  });
  return result;
};

export const sameThreadTagsContent = (
  left: ThreadTagsContent | undefined,
  right: ThreadTagsContent | undefined
): boolean => {
  const leftTags = left?.tags ?? {};
  const rightTags = right?.tags ?? {};
  const leftKeys = Object.keys(leftTags).sort();
  const rightKeys = Object.keys(rightTags).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    const leftKey = leftKeys[i];
    const rightKey = rightKeys[i];
    if (leftKey !== rightKey) return false;

    const leftTag = leftTags[leftKey];
    const rightTag = rightTags[rightKey];
    if (!leftTag || !rightTag) return false;
    if (leftTag.set_by !== rightTag.set_by || leftTag.set_at !== rightTag.set_at) {
      return false;
    }
  }
  return true;
};

export const resetPendingThreadTagsForTests = () => {
  pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
  pendingTimeouts.clear();
  pendingTags.clear();
  pendingVersion = 0;
  emitPendingChange();
};
