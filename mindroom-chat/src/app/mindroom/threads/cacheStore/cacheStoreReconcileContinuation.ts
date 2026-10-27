import { readMetaRecord, updateMetaRecord } from './cacheStoreMeta';
import { buildMetaKey, type CachedMetaRecord } from './cacheStoreSchema';

export type ThreadReconcileContinuation = NonNullable<
  CachedMetaRecord['threadReconcileContinuation']
>;

export const loadThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string
): Promise<ThreadReconcileContinuation | undefined> => {
  const existing = await readMetaRecord(sessionId, roomId, threadId);
  return existing?.threadReconcileContinuation;
};

/** Create a continuation unless another pass already owns one. */
export const beginThreadReconcileContinuation = (
  sessionId: string,
  roomId: string,
  threadId: string,
  candidate: ThreadReconcileContinuation
): Promise<ThreadReconcileContinuation> =>
  updateMetaRecord(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (current) return current;
    store.put({
      ...(existing ?? {
        metaKey: buildMetaKey(roomId, threadId),
        roomId,
        scope: threadId,
      }),
      updatedAt: Date.now(),
      threadReconcileContinuation: candidate,
    } satisfies CachedMetaRecord);
    return candidate;
  });

export const checkpointThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string,
  nextToken: string
): Promise<boolean> =>
  updateMetaRecord(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return false;
    store.put({
      ...existing,
      updatedAt: Date.now(),
      threadReconcileContinuation: { ...current, nextToken },
    } satisfies CachedMetaRecord);
    return true;
  });

/** Restart from the live head while retaining the original overlap boundary. */
export const restartThreadReconcileContinuationFromHead = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string,
  nextGeneration: string
): Promise<ThreadReconcileContinuation | undefined> =>
  updateMetaRecord(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return undefined;
    const { nextToken: _drop, ...marker } = current;
    const restarted = {
      ...marker,
      generation: nextGeneration,
      validatingHead: true as const,
    };
    store.put({
      ...existing,
      updatedAt: Date.now(),
      threadReconcileContinuation: restarted,
    } satisfies CachedMetaRecord);
    return restarted;
  });

export const clearThreadReconcileContinuation = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  expectedGeneration: string
): Promise<boolean> =>
  updateMetaRecord(sessionId, roomId, threadId, (existing, store) => {
    const current = existing?.threadReconcileContinuation;
    if (!existing || current?.generation !== expectedGeneration) return false;
    const { threadReconcileContinuation: _drop, ...rest } = existing;
    store.put({ ...rest, updatedAt: Date.now() } satisfies CachedMetaRecord);
    return true;
  });
