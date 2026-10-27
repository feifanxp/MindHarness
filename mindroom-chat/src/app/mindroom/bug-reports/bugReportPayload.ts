import { Capacitor } from '@capacitor/core';
import { RelationType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { APP_BUILD_VERSION } from '../../../appVersion';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { buildDiagnosticsPayload, type DiagnosticsPayload } from '../diagnostics/diagnosticsExport';
import { getThreadReplyEventsForRoot } from '../threads/threadUtils';

export const BUG_REPORT_TYPE = 'io.mindroom.bug_report';
export const BUG_REPORT_VERSION = 1;
const MAIN_TIMELINE_EVENT_LIMIT = 50;
const THREAD_REPLY_LIMIT = 200;

type RawEvent = Record<string, unknown>;

export type BugReportEvent = {
  eventId: string | null;
  status: string | null;
  decryptionFailure: boolean;
  event: RawEvent;
  latestEdit: RawEvent | null;
};

export type BugReport = {
  type: typeof BUG_REPORT_TYPE;
  version: typeof BUG_REPORT_VERSION;
  reportedAt: string;
  reporter: { userId: string; deviceId: string | null; homeserver: string };
  target: {
    roomId: string;
    roomName: string;
    threadId: string | null;
    eventId: string;
    permalink: string;
  };
  events: BugReportEvent[];
  /** Thread replies this client holds that the 200-reply bound left out of `events`. */
  omittedEventCount: number;
  client: {
    build: string;
    platform: string;
    userAgent: string;
    language: string;
    timeZone: string;
    viewport: { width: number; height: number; devicePixelRatio: number };
    online: boolean;
    visibility: string;
    syncState: string | null;
    location: string;
  };
  diagnostics: DiagnosticsPayload;
};

/**
 * The decrypted event as it was sent. getEffectiveEvent() alone would carry the latest
 * edit's m.new_content (which has no m.relates_to) instead of the original content.
 */
const getOriginalEvent = (event: MatrixEvent): RawEvent => {
  const content: RawEvent = { ...event.getOriginalContent() };
  // Encrypted events keep m.relates_to in the wire content, outside the ciphertext.
  const wireRelation = event.getWireContent()['m.relates_to'];
  if (content['m.relates_to'] === undefined && wireRelation !== undefined) {
    content['m.relates_to'] = wireRelation;
  }
  return { ...(event.getEffectiveEvent() as unknown as RawEvent), content };
};

const serializeEvent = (event: MatrixEvent): BugReportEvent => ({
  eventId: event.getId() ?? null,
  status: event.status ?? null,
  decryptionFailure: event.isDecryptionFailure(),
  event: getOriginalEvent(event),
  latestEdit: (event.replacingEvent()?.getEffectiveEvent() as RawEvent | undefined) ?? null,
});

const isEditEvent = (event: MatrixEvent): boolean =>
  event.getRelation()?.rel_type === RelationType.Replace;

/**
 * The events an administrator needs to see the reported message in context.
 * `m.replace` edits are left out (streaming produces hundreds); each event's
 * latest edit is attached to it instead. Reactions are kept.
 *
 * Thread scope: the root plus the newest 200 replies, or the 200 ending at an older
 * selected reply; `omittedEventCount` counts the held replies left out.
 * Main-timeline scope: the 50 events up to the selected event; nothing is counted as omitted.
 */
export const collectReportEvents = (
  room: Room,
  mEvent: MatrixEvent
): { events: MatrixEvent[]; omittedEventCount: number } => {
  const eventId = mEvent.getId();
  const isReportable = (event: MatrixEvent) => event.getId() === eventId || !isEditEvent(event);

  const threadId = mEvent.threadRootId;
  if (threadId) {
    const byId = new Map<string, MatrixEvent>();
    const add = (event: MatrixEvent | null | undefined) => {
      const id = event?.getId();
      if (event && id && isReportable(event) && !byId.has(id)) byId.set(id, event);
    };
    const thread = room.getThread(threadId);
    add(room.findEventById(threadId) ?? thread?.rootEvent);
    (thread?.events ?? []).forEach(add);
    getThreadReplyEventsForRoot(room.getLiveTimeline().getEvents(), threadId).forEach(add);
    add(mEvent);
    const root = byId.get(threadId);
    const replies = [...byId.values()]
      .filter((event) => event !== root)
      .sort((a, b) => a.getTs() - b.getTs());
    const selected = replies.findIndex((event) => event.getId() === eventId);
    const end =
      selected === -1 || selected >= replies.length - THREAD_REPLY_LIMIT
        ? replies.length
        : selected + 1;
    const kept = replies.slice(Math.max(0, end - THREAD_REPLY_LIMIT), end);
    return {
      events: root ? [root, ...kept] : kept,
      omittedEventCount: replies.length - kept.length,
    };
  }

  const timeline = (eventId ? room.getTimelineForEvent(eventId) : null) ?? room.getLiveTimeline();
  const events = timeline.getEvents().filter(isReportable);
  const index = events.findIndex((event) => event.getId() === eventId);
  const tail =
    index === -1
      ? [...events.slice(-(MAIN_TIMELINE_EVENT_LIMIT - 1)), mEvent]
      : events.slice(Math.max(0, index + 1 - MAIN_TIMELINE_EVENT_LIMIT), index + 1);
  return { events: tail, omittedEventCount: 0 };
};

const buildClientState = (mx: MatrixClient): BugReport['client'] => ({
  build: APP_BUILD_VERSION,
  platform: Capacitor.getPlatform(),
  userAgent: navigator.userAgent,
  language: navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  },
  online: navigator.onLine,
  visibility: document.visibilityState,
  syncState: mx.getSyncState(),
  location: window.location.href,
});

export const buildBugReport = async (
  mx: MatrixClient,
  room: Room,
  mEvent: MatrixEvent,
  now: Date = new Date()
): Promise<BugReport> => {
  const eventId = mEvent.getId() ?? '';
  const { events, omittedEventCount } = collectReportEvents(room, mEvent);
  return {
    type: BUG_REPORT_TYPE,
    version: BUG_REPORT_VERSION,
    reportedAt: now.toISOString(),
    reporter: {
      userId: mx.getSafeUserId(),
      deviceId: mx.getDeviceId(),
      homeserver: mx.getHomeserverUrl(),
    },
    target: {
      roomId: room.roomId,
      roomName: room.name,
      threadId: mEvent.threadRootId ?? null,
      eventId,
      permalink: getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)),
    },
    events: events.map(serializeEvent),
    omittedEventCount,
    client: buildClientState(mx),
    diagnostics: await buildDiagnosticsPayload(now.getTime()),
  };
};

export const getBugReportFileName = (report: BugReport): string =>
  `mindroom-bug-report-${report.reportedAt.replace(/[:.]/g, '-')}.json`;

export const serializeBugReport = (report: BugReport): Blob =>
  new Blob([JSON.stringify(report)], { type: 'application/json' });
