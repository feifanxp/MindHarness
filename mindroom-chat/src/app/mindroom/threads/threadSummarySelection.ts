import {
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';

export const selectThreadSummaryUpdate = (
  cachedInfo: MindroomThreadSummaryInfo | undefined,
  ...loadedInfos: Array<MindroomThreadSummaryInfo | undefined>
): MindroomThreadSummaryInfo | undefined => {
  const preferred = pickLatestThreadSummaryInfo(cachedInfo, ...loadedInfos);
  if (!preferred?.summaryText) return undefined;
  return cachedInfo?.summaryText !== preferred.summaryText ||
    cachedInfo?.generatedTs !== preferred.generatedTs ||
    cachedInfo?.eventTs !== preferred.eventTs ||
    cachedInfo?.messageCount !== preferred.messageCount ||
    cachedInfo?.isManual !== preferred.isManual
    ? preferred
    : undefined;
};

export const buildPreferredThreadSummaryMap = (
  cachedSummaryMap: Map<string, MindroomThreadSummaryInfo>,
  loadedSummaryMap: Map<string, MindroomThreadSummaryInfo>,
  incomingCandidates?: ReadonlyMap<string, Array<MindroomThreadSummaryInfo | undefined>>
): Map<string, MindroomThreadSummaryInfo> => {
  const merged = new Map<string, MindroomThreadSummaryInfo>();
  const threadRootIds = new Set([
    ...cachedSummaryMap.keys(),
    ...loadedSummaryMap.keys(),
    ...(incomingCandidates?.keys() ?? []),
  ]);

  threadRootIds.forEach((threadRootId) => {
    const info = pickLatestThreadSummaryInfo(
      cachedSummaryMap.get(threadRootId),
      loadedSummaryMap.get(threadRootId),
      ...(incomingCandidates?.get(threadRootId) ?? [])
    );
    if (info?.summaryText) merged.set(threadRootId, info);
  });

  return merged;
};
