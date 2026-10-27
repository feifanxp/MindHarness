import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ThreadCacheCoverage } from './types';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';

export type ThreadOverviewCachedMetadataSnapshot = {
  compactRootBodyMap: Map<string, string>;
  compactRootSourceTsMap: Map<string, number>;
  lastActivityTsMap: Map<string, number>;
  latestReplyPreviewMap: Map<string, string>;
  lastSenderIdMap: Map<string, string>;
  messageCountMap: Map<string, number>;
  coverageMap: Map<string, ThreadCacheCoverage>;
};

export type ThreadOverviewCachedMetadataUpdate = {
  rootId: string;
  nextActivityTs?: number;
  nextPreview?: string;
  nextPreviewSourceTs?: number;
  nextReplyPreviewText?: string;
  nextLastSenderId?: string;
  nextMessageCount?: number;
  nextCacheCoverage?: ThreadCacheCoverage;
};

export type ApplyThreadOverviewCachedMetadataUpdatesOptions = {
  includeCompactRootBody: boolean;
};

export type ThreadOverviewCachedMetadataController = ThreadOverviewCachedMetadataSnapshot & {
  compactRootPreviewAttemptCountsRef: MutableRefObject<Map<string, number>>;
  applyUpdate: (
    update: ThreadOverviewCachedMetadataUpdate | null | undefined,
    options?: ApplyThreadOverviewCachedMetadataUpdatesOptions
  ) => void;
  applyUpdates: (
    updates: ThreadOverviewCachedMetadataUpdate[],
    options: ApplyThreadOverviewCachedMetadataUpdatesOptions
  ) => void;
};

export const createEmptyThreadOverviewCachedMetadata =
  (): ThreadOverviewCachedMetadataSnapshot => ({
    compactRootBodyMap: new Map(),
    compactRootSourceTsMap: new Map(),
    lastActivityTsMap: new Map(),
    latestReplyPreviewMap: new Map(),
    lastSenderIdMap: new Map(),
    messageCountMap: new Map(),
    coverageMap: new Map(),
  });

const updateMap = <K, V>(
  previous: Map<K, V>,
  entries: Array<{ key: K; value: V | undefined }>
): Map<K, V> => {
  let next: Map<K, V> | undefined;

  entries.forEach(({ key, value }) => {
    if (value === undefined || Object.is(previous.get(key), value)) return;
    if (!next) next = new Map(previous);
    next.set(key, value);
  });

  return next ?? previous;
};

export const applyThreadOverviewCachedMetadataUpdates = (
  previous: ThreadOverviewCachedMetadataSnapshot,
  updates: ThreadOverviewCachedMetadataUpdate[],
  { includeCompactRootBody }: ApplyThreadOverviewCachedMetadataUpdatesOptions
): ThreadOverviewCachedMetadataSnapshot => {
  if (updates.length === 0) return previous;

  const compactRootBodyMap = includeCompactRootBody
    ? updateMap(
        previous.compactRootBodyMap,
        updates.map(({ rootId, nextPreview }) => ({ key: rootId, value: nextPreview }))
      )
    : previous.compactRootBodyMap;
  const compactRootSourceTsMap = includeCompactRootBody
    ? updateMap(
        previous.compactRootSourceTsMap,
        updates.map(({ rootId, nextPreviewSourceTs }) => ({
          key: rootId,
          value: nextPreviewSourceTs,
        }))
      )
    : previous.compactRootSourceTsMap;
  const lastActivityTsMap = updateMap(
    previous.lastActivityTsMap,
    updates.map(({ rootId, nextActivityTs }) => ({ key: rootId, value: nextActivityTs }))
  );
  const latestReplyPreviewMap = updateMap(
    previous.latestReplyPreviewMap,
    updates.map(({ rootId, nextReplyPreviewText }) => ({
      key: rootId,
      value: nextReplyPreviewText,
    }))
  );
  const lastSenderIdMap = updateMap(
    previous.lastSenderIdMap,
    updates.map(({ rootId, nextLastSenderId }) => ({ key: rootId, value: nextLastSenderId }))
  );
  const messageCountMap = updateMap(
    previous.messageCountMap,
    updates.map(({ rootId, nextMessageCount }) => ({ key: rootId, value: nextMessageCount }))
  );
  const coverageMap = updateMap(
    previous.coverageMap,
    updates.map(({ rootId, nextCacheCoverage }) => ({ key: rootId, value: nextCacheCoverage }))
  );

  if (
    compactRootBodyMap === previous.compactRootBodyMap &&
    compactRootSourceTsMap === previous.compactRootSourceTsMap &&
    lastActivityTsMap === previous.lastActivityTsMap &&
    latestReplyPreviewMap === previous.latestReplyPreviewMap &&
    lastSenderIdMap === previous.lastSenderIdMap &&
    messageCountMap === previous.messageCountMap &&
    coverageMap === previous.coverageMap
  ) {
    return previous;
  }

  return {
    compactRootBodyMap,
    compactRootSourceTsMap,
    lastActivityTsMap,
    latestReplyPreviewMap,
    lastSenderIdMap,
    messageCountMap,
    coverageMap,
  };
};

export const mergeCompactThreadRootBodyMaps = (
  liveBodyMap: ReadonlyMap<string, string>,
  cachedBodyMap: ReadonlyMap<string, string>,
  liveSourceTsMap: ReadonlyMap<string, number> = new Map(),
  cachedSourceTsMap: ReadonlyMap<string, number> = new Map()
): Map<string, string> => {
  // Prefer a complete preview over a truncated streaming placeholder. When
  // both observations are complete, revision timestamps decide; unavailable
  // timestamps retain the SDK-first fallback instead of guessing freshness.
  const bodyMap = new Map(cachedBodyMap);
  liveBodyMap.forEach((value, key) => {
    const cachedValue = bodyMap.get(key);
    if (!cachedValue) {
      bodyMap.set(key, value);
      return;
    }

    const liveIncomplete = hasLikelyIncompleteStreamingBody(value);
    const cachedIncomplete = hasLikelyIncompleteStreamingBody(cachedValue);
    if (liveIncomplete !== cachedIncomplete) {
      bodyMap.set(key, liveIncomplete ? cachedValue : value);
      return;
    }

    const liveSourceTs = liveSourceTsMap.get(key);
    const cachedSourceTs = cachedSourceTsMap.get(key);
    bodyMap.set(
      key,
      cachedSourceTs !== undefined && liveSourceTs !== undefined && cachedSourceTs > liveSourceTs
        ? cachedValue
        : value
    );
  });
  return bodyMap;
};

export const useThreadOverviewCachedMetadata = (
  roomId: string
): ThreadOverviewCachedMetadataController => {
  const [snapshot, setSnapshot] = useState(createEmptyThreadOverviewCachedMetadata);
  const snapshotRoomIdRef = useRef(roomId);
  const compactRootPreviewAttemptCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // The initial snapshot is already empty; replacing it rebuilds every thread record.
    if (snapshotRoomIdRef.current === roomId) return;
    snapshotRoomIdRef.current = roomId;
    compactRootPreviewAttemptCountsRef.current = new Map();
    setSnapshot(createEmptyThreadOverviewCachedMetadata());
  }, [roomId]);

  const applyUpdates = useCallback(
    (
      updates: ThreadOverviewCachedMetadataUpdate[],
      options: ApplyThreadOverviewCachedMetadataUpdatesOptions
    ) => {
      setSnapshot((previous) =>
        applyThreadOverviewCachedMetadataUpdates(previous, updates, options)
      );
    },
    []
  );

  const applyUpdate = useCallback(
    (
      update: ThreadOverviewCachedMetadataUpdate | null | undefined,
      options: ApplyThreadOverviewCachedMetadataUpdatesOptions = {
        includeCompactRootBody: true,
      }
    ) => {
      if (!update) return;
      applyUpdates([update], options);
    },
    [applyUpdates]
  );

  return useMemo(
    () => ({
      ...snapshot,
      compactRootPreviewAttemptCountsRef,
      applyUpdate,
      applyUpdates,
    }),
    [applyUpdate, applyUpdates, snapshot]
  );
};
