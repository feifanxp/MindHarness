import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { VisibleThreadRootData } from './roomThreadOverviewModel';
import { buildThreadRecordMap } from './threadRecord';
import type { ThreadOverviewCachedMetadataSnapshot } from './threadOverviewCacheMetadata';
import type { ThreadScheduledStatus } from './threadScheduledStatus';
import type { ThreadRecord } from './types';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags: Record<string, unknown> | null;
};

export type BuildMindroomThreadIndexRecordMapsOptions = {
  threadId: string | undefined;
  compactViewRequested: boolean;
  room: Room;
  visibleThreadRootData: VisibleThreadRootData;
  compactThreadRootData: VisibleThreadRootData;
  visibleThreadRootEventMap: ReadonlyMap<string, MatrixEvent>;
  compactThreadRootEventMap: ReadonlyMap<string, MatrixEvent>;
  compactThreadRootBodyMap: ReadonlyMap<string, string>;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackSummaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackReplyCountMap: ReadonlyMap<string, number>;
  cachedMetadata: Pick<
    ThreadOverviewCachedMetadataSnapshot,
    | 'latestReplyPreviewMap'
    | 'lastSenderIdMap'
    | 'messageCountMap'
    | 'lastActivityTsMap'
    | 'coverageMap'
  >;
  fallbackParticipantMap: ReadonlyMap<string, string[]>;
  threadResolutionMap: ReadonlyMap<string, ThreadResolutionLike>;
  currentUserId: string | undefined;
  scheduledStatusMap: ReadonlyMap<string, ThreadScheduledStatus>;
};

export type MindroomThreadIndexRecordMaps = {
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
};

export const buildMindroomThreadIndexRecordMaps = ({
  threadId,
  compactViewRequested,
  room,
  visibleThreadRootData,
  compactThreadRootData,
  visibleThreadRootEventMap,
  compactThreadRootEventMap,
  compactThreadRootBodyMap,
  summaryMap,
  fallbackSummaryMap,
  fallbackReplyCountMap,
  cachedMetadata,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  scheduledStatusMap,
}: BuildMindroomThreadIndexRecordMapsOptions): MindroomThreadIndexRecordMaps => {
  const emptyThreadRecordMap = new Map<string, ThreadRecord>();
  if (threadId) {
    return {
      normalThreadRecordMap: emptyThreadRecordMap,
      compactThreadRecordMap: emptyThreadRecordMap,
    };
  }

  const sharedRecordOptions = {
    room,
    summaryMap,
    fallbackSummaryMap,
    fallbackReplyCountMap,
    fallbackLatestReplyPreviewMap: cachedMetadata.latestReplyPreviewMap,
    fallbackLastSenderIdMap: cachedMetadata.lastSenderIdMap,
    fallbackMessageCountMap: cachedMetadata.messageCountMap,
    fallbackLastActivityTsMap: cachedMetadata.lastActivityTsMap,
    fallbackParticipantMap,
    threadResolutionMap,
    currentUserId,
    scheduledStatusMap,
    cacheCoverageMap: cachedMetadata.coverageMap,
  };

  const normalThreadRecordMap = buildThreadRecordMap({
    ...sharedRecordOptions,
    threadRootIds: visibleThreadRootData.ids,
    threadRootEventMap: visibleThreadRootEventMap,
    rootPreviewTextMap: visibleThreadRootData.bodyMap,
    absoluteIndexMap: visibleThreadRootData.indexMap,
  });
  const compactThreadRecordMap = compactViewRequested
    ? buildThreadRecordMap({
        ...sharedRecordOptions,
        threadRootIds: compactThreadRootData.ids,
        threadRootEventMap: compactThreadRootEventMap,
        rootPreviewTextMap: compactThreadRootBodyMap,
        absoluteIndexMap: compactThreadRootData.indexMap,
      })
    : normalThreadRecordMap;

  return {
    normalThreadRecordMap,
    compactThreadRecordMap,
  };
};
