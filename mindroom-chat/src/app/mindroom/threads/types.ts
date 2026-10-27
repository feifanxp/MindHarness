import type { IEvent, MatrixEvent } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ThreadPreviewLocalization } from './threadMessagePreview';

export type ThreadId = {
  roomId: string;
  threadRootId: string;
};

export type ThreadPresentationSnapshot = {
  summaryInfo: MindroomThreadSummaryInfo | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  latestReplyPreviewText: string | undefined;
  rootPreviewLocalization?: ThreadPreviewLocalization;
  latestReplyPreviewLocalization?: ThreadPreviewLocalization;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  messageCount: number;
  participantIds: string[];
  replyParticipantIds: string[];
  primarySummaryText: string | undefined;
  recentThreadSummaryText: string | undefined;
};

export type ThreadStatusSnapshot = {
  isKnownThreadRoot: boolean;
  replyCount: number;
  isResolved: boolean;
  resolvedByUserId?: string;
  isUnread: boolean;
  isStreaming: boolean;
  hasPendingSend?: boolean;
  hasFailedSend?: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  cronDescription?: string;
  lastActivityTs?: number;
  tags: string[];
};

export type ThreadCacheCoverage = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  hasMoreBackward?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete: boolean;
  tailLoaded: boolean;
  expectedReplyCount?: number;
};

/**
 * The result of hydrating a thread's page from the MindRoom cache.
 *
 * Defined here (a pure, React-free types module) rather than in the
 * `threadOpenCacheController` hook that produces it: the engine
 * reconciler is an authoritative consumer, and the engine must not
 * import from the React adapter layer (`threads/*Controller*`) —
 * enforced by `engine/__tests__/engine.architecture.test.ts`.
 */
export type HydratedThreadCachePage = {
  beforeToken?: string | null;
  cacheCoverage: ThreadCacheCoverage;
  events: Partial<IEvent>[];
  /**
   * CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): the SAME MatrixEvent
   * instances that were handed to `setSupplementalThreadEvents` on cache
   * hydrate — i.e. the objects the render layer is holding via
   * `fallbackThreadEventsState.events`. The reconciler needs identity
   * with these to make `applyCachedReplaceRelations`/`makeRedacted`
   * mutations actually visible in the render, instead of mutating a
   * fresh clone nobody reads. Undefined on the empty-cache branch.
   */
  hydratedEvents?: MatrixEvent[];
  /**
   * Companion to `hydratedEvents` for the root event. Same identity
   * contract: this is the instance the render will pick up when
   * `thread?.rootEvent` is unavailable (e.g. cold cache-first reopen
   * with an empty SDK thread model).
   */
  hydratedRootEvent?: MatrixEvent;
  expectedReplyCount?: number;
  hasMoreBefore: boolean;
  relationSnapshotComplete: boolean;
  rootEvent?: Partial<IEvent>;
  snapshotComplete: boolean;
  tailLoaded: boolean;
};

export type ThreadRecord = ThreadId & {
  rootEventId?: string;
  presentation: ThreadPresentationSnapshot;
  status: ThreadStatusSnapshot;
  cache: ThreadCacheCoverage;
  absoluteIndex: number;
};

export type ThreadParticipantViewModel = {
  userId: string;
  displayName: string;
  avatarUrl?: string;
};

export type CompactThreadAttentionState =
  | 'needs-attention'
  | 'waiting'
  | 'streaming'
  | 'resolved'
  | 'idle';

export type CompactThreadCardViewModel = {
  id: ThreadId;
  titleText: string;
  displayTitleText: string;
  previewText: string;
  primarySummaryText?: string;
  recentThreadSummaryText?: string;
  messageCount: number;
  messageCountLabel: string;
  /** Locale-formatted count alone, for the compact card's icon + number. */
  messageCountText: string;
  attentionState: CompactThreadAttentionState;
  attentionStatusText: string;
  participants: ThreadParticipantViewModel[];
  tags: string[];
  isResolved: boolean;
  resolvedByDisplayName?: string;
  isUnread: boolean;
  isStreaming: boolean;
  hasPendingSend?: boolean;
  hasFailedSend?: boolean;
  scheduledDisplayText?: string;
  scheduledTaskLabel?: string;
  lastActivityTs?: number;
  lastActivityTitle?: string;
};

export type ThreadBadgeViewModel = {
  id: ThreadId;
  summaryInfo?: MindroomThreadSummaryInfo;
  recentThreadSummaryText?: string;
  replyCount: number;
  participantIds?: string[];
  isResolved: boolean;
};

export type ThreadHeaderViewModel = {
  summaryText?: string;
  displayTags: string[];
  isResolved: boolean;
  canEdit: boolean;
  availableTags: string[];
  pickerDisabled: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  scheduledDisplayText?: string;
  scheduledLabel?: string;
  bannerScheduledText?: string;
};

export type RecentThreadViewModel = {
  id: ThreadId;
  storedThreadId: string;
  openedAt: number;
  roomName: string;
  summaryText: string;
  persistableSummaryText?: string;
  shouldRekey: boolean;
};

export type CommandPaletteThreadViewModel = {
  id: ThreadId;
  summaryText: string;
  isFallbackSummary?: boolean;
  roomName: string;
  participantNames?: string[];
  tags?: string[];
  isResolved?: boolean;
  messageCount?: number;
  sortRank?: number;
  boost?: number;
};
