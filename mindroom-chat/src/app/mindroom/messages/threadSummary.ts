import { trimReplyFromBody } from '../../utils/room';

const THREAD_SUMMARY_METADATA_KEY = 'io.mindroom.thread_summary';

// ── Shared helper ──────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// ── Original: content-level helpers (used by RenderMessageContent / MsgTypeRenderers) ──

type MindroomThreadSummaryMetadata = {
  model?: unknown;
  version?: unknown;
  generated_at?: unknown;
  message_count?: unknown;
  summary?: unknown;
};

export type MindroomThreadSummaryInfo = {
  isManual?: boolean;
  summaryText?: string;
  /** Accepted Matrix event (or replacement) timestamp, absent on legacy cache/local echoes. */
  eventTs?: number;
  /** Accepted Matrix event carrying the summary, so its redaction can clear cached copies. */
  eventId?: string;
  generatedTs?: number;
  messageCount?: number;
};

// Match the backend datetime range so extended-year metadata cannot poison
// ordering in live data or older cached snapshots.
export const isSupportedThreadSummaryTimestamp = (value: number): boolean =>
  Number.isFinite(value) && value >= -62_135_596_800_000 && value <= 253_402_300_799_999;

const hasSummaryText = (
  info: MindroomThreadSummaryInfo | undefined
): info is MindroomThreadSummaryInfo & { summaryText: string } =>
  typeof info?.summaryText === 'string' &&
  info.summaryText.trim().length > 0 &&
  (info.generatedTs === undefined || isSupportedThreadSummaryTimestamp(info.generatedTs));

const compareDefinedNumbers = (left?: number, right?: number): number | undefined => {
  const hasLeft = typeof left === 'number' && Number.isFinite(left);
  const hasRight = typeof right === 'number' && Number.isFinite(right);

  if (hasLeft && hasRight) {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
  return undefined;
};

export const pickLatestThreadSummaryInfo = (
  ...infos: Array<MindroomThreadSummaryInfo | undefined>
): MindroomThreadSummaryInfo | undefined => {
  let preferred: MindroomThreadSummaryInfo | undefined;
  // Evaluate the entire merge before discarding candidates: an undated legacy
  // value must not hide a newer agent summary before a manual candidate arrives.
  const hasDatedManual = infos.some(
    (info) => hasSummaryText(info) && info.isManual && info.generatedTs !== undefined
  );
  // Older cache records have no server timestamp. If this batch includes the
  // same notice from Matrix, discard the incomplete copy before reduction:
  // otherwise it can hide a later server event through its skewed metadata.
  const knownEvents = infos.filter((info) => hasSummaryText(info) && info.eventTs !== undefined);

  infos.forEach((candidate) => {
    if (!hasSummaryText(candidate) || (hasDatedManual && candidate.generatedTs === undefined))
      return;
    if (
      candidate.eventTs === undefined &&
      knownEvents.some(
        (known) =>
          known?.summaryText === candidate.summaryText &&
          known?.generatedTs === candidate.generatedTs &&
          known?.messageCount === candidate.messageCount
      )
    )
      return;
    if (!hasSummaryText(preferred)) {
      preferred = candidate;
      return;
    }

    // Match backend pin decisions using server chronology. Old cache records
    // lack this field, so retain metadata ordering until live data enriches them.
    const eventComparison = compareDefinedNumbers(candidate.eventTs, preferred.eventTs);
    if (eventComparison === 1) {
      preferred = candidate;
      return;
    }
    if (eventComparison === -1) return;

    const tsComparison = compareDefinedNumbers(candidate.generatedTs, preferred.generatedTs);
    if (tsComparison === 1) {
      preferred = candidate;
      return;
    }
    if (tsComparison === -1) return;

    const messageCountComparison = compareDefinedNumbers(
      candidate.messageCount,
      preferred.messageCount
    );
    if (messageCountComparison === 1) {
      preferred = candidate;
      return;
    }
    if (messageCountComparison === -1) {
      return;
    }

    const candidateHasMessageCount =
      typeof candidate.messageCount === 'number' && Number.isFinite(candidate.messageCount);
    const preferredHasMessageCount =
      typeof preferred.messageCount === 'number' && Number.isFinite(preferred.messageCount);

    if (candidateHasMessageCount && !preferredHasMessageCount) {
      preferred = candidate;
      return;
    }

    if (
      candidate.summaryText === preferred.summaryText &&
      candidate.generatedTs === preferred.generatedTs
    ) {
      if (candidate.eventTs !== undefined && preferred.eventTs === undefined) {
        preferred = candidate;
        return;
      }
      if (candidate.eventTs === undefined && preferred.eventTs !== undefined) return;
    }

    if (
      candidate.summaryText !== preferred.summaryText ||
      candidate.isManual !== preferred.isManual
    ) {
      preferred = candidate;
    }
  });

  return preferred;
};

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asSummaryBody = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const trimmed = trimReplyFromBody(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asTimestamp = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asMessageCount = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
};

const getThreadSummaryCandidates = (
  content: Record<string, unknown>
): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  return newContent ? [newContent, content] : [content];
};

const getThreadSummaryMetadataFromCandidate = (
  content: Record<string, unknown>
): MindroomThreadSummaryMetadata | undefined => {
  const metadata = content[THREAD_SUMMARY_METADATA_KEY];
  if (!isRecord(metadata) || metadata.version !== 1) return undefined;
  return metadata as MindroomThreadSummaryMetadata;
};

const getMindroomThreadSummaryMetadata = (
  content: Record<string, unknown>
): MindroomThreadSummaryMetadata | undefined =>
  getThreadSummaryCandidates(content)
    .map(getThreadSummaryMetadataFromCandidate)
    .find((metadata): metadata is MindroomThreadSummaryMetadata => metadata !== undefined);

const hasLegacyMindroomThreadSummary = (content: Record<string, unknown>): boolean =>
  getThreadSummaryCandidates(content).some(
    (candidate) => candidate[THREAD_SUMMARY_METADATA_KEY] === true
  );

const getThreadSummaryBody = (content: Record<string, unknown>): string | undefined =>
  getThreadSummaryCandidates(content)
    .map((candidate) => asSummaryBody(candidate.body))
    .find((body): body is string => body !== undefined);

export const hasMindroomThreadSummary = (content: Record<string, unknown>): boolean =>
  hasLegacyMindroomThreadSummary(content) || !!getMindroomThreadSummaryMetadata(content);

export const getMindroomThreadSummaryInfo = (
  content: Record<string, unknown>
): MindroomThreadSummaryInfo | undefined => {
  const metadata = getMindroomThreadSummaryMetadata(content);
  if (!metadata) return undefined;

  const hasNewContent = isRecord(content['m.new_content']);
  const summaryBody = getThreadSummaryBody(content);
  const summaryText =
    (hasNewContent ? summaryBody ?? asNonEmptyString(metadata.summary) : undefined) ??
    (!hasNewContent ? asNonEmptyString(metadata.summary) ?? summaryBody : undefined);

  return {
    ...(metadata.model === 'manual' ? { isManual: true } : {}),
    summaryText,
    generatedTs: asTimestamp(metadata.generated_at),
    messageCount: asMessageCount(metadata.message_count),
  };
};

export const formatMindroomThreadSummaryMessageCount = (count: number): string =>
  `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'message' : 'messages'}`;

// ── CINNY-003b: event-level helpers (used by RoomTimeline) ─────────

type ThreadSummaryEventLike = {
  status?: string | null;
  getId?(): string | undefined;
  getContent(): Record<string, unknown>;
  getTs?(): number | undefined;
  replacingEventDate?(): Date | undefined;
  replacingEvent?(): { status?: string | null } | null;
};

export const isMindroomThreadSummaryEvent = (event: ThreadSummaryEventLike): boolean => {
  if (event.status != null && event.status !== 'sent') return false;
  const content = event.getContent();
  const msgtype = content.msgtype;
  if (msgtype !== 'm.notice') return false;
  return !!content[THREAD_SUMMARY_METADATA_KEY];
};

export const findLatestThreadSummaryEvent = <T extends ThreadSummaryEventLike>(
  events: T[]
): T | undefined => {
  let latest: T | undefined;
  let latestInfo: MindroomThreadSummaryInfo | undefined;
  events.forEach((event) => {
    if (!isMindroomThreadSummaryEvent(event)) return;
    const info = getThreadSummaryEventInfo(event);
    if (info && pickLatestThreadSummaryInfo(latestInfo, info) === info) {
      latest = event;
      latestInfo = info;
    }
  });
  return latest;
};

export const getThreadSummaryPreviewText = (event: ThreadSummaryEventLike): string | undefined => {
  const content = event.getContent();

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  const body = newContent?.body ?? content.body;
  if (typeof body === 'string' && body.length > 0) return body;
  return undefined;
};

type ThreadSummaryBuildEventLike = ThreadSummaryEventLike & {
  getId(): string | undefined;
  threadRootId?: string;
};

type SummaryEventCacheEntry = {
  hasMetadata: boolean;
  hasNewContent: boolean;
  body: unknown;
  newBody: unknown;
  summary: unknown;
  generatedAt: unknown;
  messageCount: unknown;
  model: unknown;
  eventTs: number | undefined;
  eventId: string | undefined;
  info: MindroomThreadSummaryInfo | undefined;
};

const summaryEventCache = new WeakMap<ThreadSummaryEventLike, SummaryEventCacheEntry>();

export const getThreadSummaryEventInfo = (
  event: ThreadSummaryEventLike
): MindroomThreadSummaryInfo | undefined => {
  const content = event.getContent();
  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;
  const metadata = getMindroomThreadSummaryMetadata(content);
  // The SDK's accepted local echo still has its send-start timestamp.
  // Only a remote event supplies server chronology, including accepted edits.
  const timestamp = event.replacingEventDate?.()?.getTime() ?? event.getTs?.();
  const eventTs =
    event.status == null &&
    event.replacingEvent?.()?.status == null &&
    timestamp !== undefined &&
    isSupportedThreadSummaryTimestamp(timestamp)
      ? timestamp
      : undefined;
  const eventId = eventTs !== undefined ? event.getId?.() : undefined;
  const cached = summaryEventCache.get(event);
  // Inspect values, not just object identity: SDK edits, decryption and cached
  // event enrichment can change existing objects between overview refreshes.
  if (
    cached &&
    cached.hasMetadata === !!metadata &&
    cached.hasNewContent === !!newContent &&
    cached.body === content.body &&
    cached.newBody === newContent?.body &&
    cached.summary === metadata?.summary &&
    cached.generatedAt === metadata?.generated_at &&
    cached.messageCount === metadata?.message_count &&
    cached.model === metadata?.model &&
    cached.eventTs === eventTs &&
    cached.eventId === eventId
  ) {
    return cached.info;
  }
  const info = getMindroomThreadSummaryInfo(content);
  // Fall back to body extraction for simple boolean flag format
  const text = getThreadSummaryPreviewText(event);
  const summary = info ?? (text ? { summaryText: text } : undefined);
  const result =
    summary && eventTs !== undefined
      ? { ...summary, eventTs, ...(eventId ? { eventId } : {}) }
      : summary;
  summaryEventCache.set(event, {
    hasMetadata: !!metadata,
    hasNewContent: !!newContent,
    body: content.body,
    newBody: newContent?.body,
    summary: metadata?.summary,
    generatedAt: metadata?.generated_at,
    messageCount: metadata?.message_count,
    model: metadata?.model,
    eventTs,
    eventId,
    info: result,
  });
  return result;
};

export const getLatestThreadSummaryInfo = <T extends ThreadSummaryEventLike>(
  events: T[]
): MindroomThreadSummaryInfo | undefined => {
  const summaryEvent = findLatestThreadSummaryEvent(events);
  if (!summaryEvent) return undefined;

  const info = getThreadSummaryEventInfo(summaryEvent);
  return info?.summaryText ? info : undefined;
};

export const getLatestThreadSummaryInfoFromEventSources = <T extends ThreadSummaryEventLike>(
  ...eventSources: Array<T[] | undefined>
): MindroomThreadSummaryInfo | undefined =>
  pickLatestThreadSummaryInfo(...getThreadSummaryInfosFromEventSources(...eventSources));

export const getThreadSummaryInfosFromEventSources = <T extends ThreadSummaryEventLike>(
  ...eventSources: Array<T[] | undefined>
): Array<MindroomThreadSummaryInfo | undefined> => {
  const infos: Array<MindroomThreadSummaryInfo | undefined> = [];
  eventSources.forEach((events, index) => {
    // SDK events and timeline alias the same array. Keep the last occurrence
    // so source precedence remains intact without scanning that history twice.
    if (!events || eventSources.lastIndexOf(events) !== index) return;
    events.forEach((event) => {
      if (isMindroomThreadSummaryEvent(event)) infos.push(getThreadSummaryEventInfo(event));
    });
  });
  return infos;
};

export const findLatestThreadSummaryEventFromEventSources = <T extends ThreadSummaryEventLike>(
  ...eventSources: Array<T[] | undefined>
): T | undefined => {
  let preferredEvent: T | undefined;
  let preferredInfo: MindroomThreadSummaryInfo | undefined;

  eventSources.forEach((events) => {
    if (!events?.length) return;

    const candidateEvent = findLatestThreadSummaryEvent(events);
    if (!candidateEvent) return;

    const candidateInfo = getThreadSummaryEventInfo(candidateEvent);
    if (!candidateInfo?.summaryText) return;

    const preferred = pickLatestThreadSummaryInfo(preferredInfo, candidateInfo);
    if (preferred === candidateInfo) {
      preferredEvent = candidateEvent;
      preferredInfo = candidateInfo;
    }
  });

  return preferredEvent;
};

export const buildThreadSummaryMap = (
  events: ThreadSummaryBuildEventLike[]
): Map<string, MindroomThreadSummaryInfo> => {
  const summaries = new Map<string, MindroomThreadSummaryInfo>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const { threadRootId } = event;
    const eventId = event.getId();
    if (!eventId || !threadRootId || eventId === threadRootId) continue;
    if (!isMindroomThreadSummaryEvent(event)) continue;

    const info = pickLatestThreadSummaryInfo(
      summaries.get(threadRootId),
      getThreadSummaryEventInfo(event)
    );
    if (info?.summaryText) summaries.set(threadRootId, info);
  }

  return summaries;
};

export { THREAD_SUMMARY_METADATA_KEY };
