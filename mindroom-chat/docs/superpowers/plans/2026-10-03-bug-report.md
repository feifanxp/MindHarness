# One-Click Bug Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use baspowers:subagent-driven-development (recommended) or baspowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Report a bug** message-menu item that, in one click, sends a full JSON bug report into the reporter's private room with the homeserver's administrators, and an administrator-side auto-join for those rooms.

**Architecture:** New focused modules under `src/app/mindroom/bug-reports/`: a well-known config parser, a payload builder, a report-room finder/creator, a sender, a menu item, and a non-UI auto-join feature. The existing diagnostics export is split so its payload object is reusable. Only `MindroomMessage.tsx` and `MindroomClientNonUIFeatures.tsx` (both fork files) gain one render line each.

**Tech Stack:** React 18, TypeScript, matrix-js-sdk, jotai, react-i18next, Vitest (+ react-test-renderer, jsdom where DOM globals are needed).

**Spec:** `docs/superpowers/specs/2026-10-03-bug-report-design.md`

## Global Constraints

- All new code lives in `src/app/mindroom/bug-reports/`.
- Well-known key: `io.mindroom.bug_reports` with `{ "admins": ["@user:server"] }`.
- Room type (create content) and account data type: both `io.mindroom.bug_reports`; account data content `{ "room_id": "!…" }`.
- Report JSON: `"type": "io.mindroom.bug_report"`, `"version": 1`.
- Summary message content key: `io.mindroom.bug_report` = `{ version: 1, room_id, thread_id, event_id }`.
- Matrix message bodies are English and never translated (`docs/localization.md`).
- UI strings go in `src/app/locales/en.json` and all 16 other locale files (the i18n test requires full coverage).
- No redaction of report content.
- Validation per step: `npm run typecheck`, `npm run lint`, `npm run build`, targeted `npx vitest run <files>`.
- Commits are small; never `git add .`; no AI attribution in commits.

---

## File Structure

| File                                                               | Responsibility                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `src/app/mindroom/diagnostics/diagnosticsExport.ts` (modify)       | Export `buildDiagnosticsPayload()`; `buildDiagnosticsExport()` wraps it    |
| `src/app/mindroom/bug-reports/bugReportConfig.ts`                  | `getBugReportAdmins(info)`                                                 |
| `src/app/mindroom/bug-reports/bugReportPayload.ts`                 | `BugReport` type, `collectReportEvents`, `buildBugReport`, file name, Blob |
| `src/app/mindroom/bug-reports/bugReportRoom.ts`                    | `ensureBugReportRoom(mx, admins)`                                          |
| `src/app/mindroom/bug-reports/sendBugReport.ts`                    | `buildBugReportSummary`, `sendBugReport`                                   |
| `src/app/mindroom/bug-reports/MessageBugReportItem.tsx`            | Menu item UI and flow                                                      |
| `src/app/mindroom/bug-reports/BugReportAutoJoinFeature.tsx`        | `shouldAutoJoinBugReportInvite`, `BugReportAutoJoinFeature`                |
| `src/app/mindroom/messages/MindroomMessage.tsx` (modify)           | Render `MessageBugReportItem`                                              |
| `src/app/mindroom/client/MindroomClientNonUIFeatures.tsx` (modify) | Mount `BugReportAutoJoinFeature`                                           |
| `src/app/locales/*.json` (modify)                                  | `mindroomUi.messages.bugReport.*` strings                                  |
| `docs/bug-reports.md`                                              | Operator setup                                                             |
| `FORK_CHANGES.md` (modify)                                         | Runbook entry                                                              |

---

### Task 1: Reusable diagnostics payload

**Files:**

- Modify: `src/app/mindroom/diagnostics/diagnosticsExport.ts`
- Test: `src/app/mindroom/diagnostics/diagnosticsExport.test.ts`

**Interfaces:**

- Produces: `buildDiagnosticsPayload(exportedAt?: number): Promise<DiagnosticsPayload>` and `type DiagnosticsPayload`; `buildDiagnosticsExport()` keeps its signature and output.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe('combined diagnostics export', …)` block in `diagnosticsExport.test.ts`, reusing the file's existing mock setup (read the file's `beforeEach` first and set the mocks the same way the neighbouring tests do):

```ts
it('builds the same payload object without serialising it', async () => {
  const { buildDiagnosticsPayload } = await import('./diagnosticsExport');
  const payload = await buildDiagnosticsPayload(1_700_000_000_000);
  expect(payload.metadata.exportSchemaVersion).toBe(4);
  expect(payload.metadata.exportedAt).toBe(1_700_000_000_000);
  expect(payload).toHaveProperty('deepTrace');
  expect(payload).toHaveProperty('deepTraceMemory');
  expect(payload).toHaveProperty('deepTraceHealth');
  expect(payload).toHaveProperty('nativeDiagnostics');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/diagnostics/diagnosticsExport.test.ts`
Expected: FAIL, `buildDiagnosticsPayload is not a function`.

- [ ] **Step 3: Implement** — in `diagnosticsExport.ts`, replace the body of `buildDiagnosticsExport` with a payload builder plus a thin wrapper:

```ts
export const buildDiagnosticsPayload = async (exportedAt: number = Date.now()) => {
  let flightRecorderPayload: ReturnType<typeof buildFlightRecorderPayload>;
  let flightRecorderStatus: 'available' | 'unavailable' = 'available';

  try {
    flightRecorderPayload = buildFlightRecorderPayload();
  } catch {
    flightRecorderStatus = 'unavailable';
    flightRecorderPayload = {
      metadata: {
        exportSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
        flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
        buildVersion: normalizeFlightRecorderBuildVersion(APP_BUILD_VERSION),
        exportedAt,
      },
      abnormalSession: null,
      currentOrPreservedSession: null,
    };
  }

  // Freeze the incident tail before a slow collector can let newer activity
  // evict it. This collector does not touch persistent storage.
  const deepTraceMemory = readDeepTraceMemorySnapshot();
  const [deepTrace, nativeDiagnostics] = await Promise.all([
    collectDeepTrace(),
    collectNativeDiagnostics(),
  ]);
  const deepTraceHealth = getDeepTraceHealthSnapshot();

  return {
    ...flightRecorderPayload,
    flightRecorderStatus,
    metadata: {
      ...flightRecorderPayload.metadata,
      exportSchemaVersion: DIAGNOSTICS_EXPORT_SCHEMA_VERSION,
      flightRecorderSchemaVersion: FLIGHT_RECORDER_SCHEMA_VERSION,
      deepTraceSchemaVersion: DEEP_TRACE_SCHEMA_VERSION,
      nativeDiagnosticsSchemaVersion: NATIVE_DIAGNOSTICS_SCHEMA_VERSION,
      exportedAt,
    },
    deepTrace,
    deepTraceMemory,
    deepTraceHealth,
    nativeDiagnostics,
  };
};

export type DiagnosticsPayload = Awaited<ReturnType<typeof buildDiagnosticsPayload>>;

export const buildDiagnosticsExport = async (): Promise<{ fileName: string; blob: Blob }> => {
  const exportedAt = Date.now();
  const payload = await buildDiagnosticsPayload(exportedAt);
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return {
    fileName: `mindroom-diagnostics-${timestamp}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  };
};
```

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run src/app/mindroom/diagnostics/diagnosticsExport.test.ts`
Expected: all tests PASS (old export tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/diagnostics/diagnosticsExport.ts src/app/mindroom/diagnostics/diagnosticsExport.test.ts
git commit -m "refactor(diagnostics): expose the export payload builder"
```

---

### Task 2: Well-known admins parser

**Files:**

- Create: `src/app/mindroom/bug-reports/bugReportConfig.ts`
- Test: `src/app/mindroom/bug-reports/bugReportConfig.test.ts`

**Interfaces:**

- Produces: `BUG_REPORTS_WELL_KNOWN_KEY = 'io.mindroom.bug_reports'`; `getBugReportAdmins(info: AutoDiscoveryInfo | null | undefined): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { getBugReportAdmins } from './bugReportConfig';

const info = (extra: Record<string, unknown>): AutoDiscoveryInfo =>
  ({ 'm.homeserver': { base_url: 'https://hs.example' }, ...extra } as AutoDiscoveryInfo);

describe('getBugReportAdmins', () => {
  it('returns valid, unique admin user IDs', () => {
    expect(
      getBugReportAdmins(
        info({
          'io.mindroom.bug_reports': {
            admins: ['@admin:example.com', '@admin:example.com', '@ops:example.com'],
          },
        })
      )
    ).toEqual(['@admin:example.com', '@ops:example.com']);
  });

  it('ignores entries that are not Matrix user IDs', () => {
    expect(
      getBugReportAdmins(
        info({
          'io.mindroom.bug_reports': {
            admins: ['admin', 42, '!room:example.com', '@ok:example.com'],
          },
        })
      )
    ).toEqual(['@ok:example.com']);
  });

  it('treats a missing or malformed key as not configured', () => {
    expect(getBugReportAdmins(null)).toEqual([]);
    expect(getBugReportAdmins(info({}))).toEqual([]);
    expect(getBugReportAdmins(info({ 'io.mindroom.bug_reports': [] }))).toEqual([]);
    expect(getBugReportAdmins(info({ 'io.mindroom.bug_reports': { admins: '@a:b.c' } }))).toEqual(
      []
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportConfig.test.ts`
Expected: FAIL, cannot resolve `./bugReportConfig`.

- [ ] **Step 3: Implement**

```ts
import type { AutoDiscoveryInfo } from '../../cs-api';
import { isUserId } from '../../utils/matrix';

export const BUG_REPORTS_WELL_KNOWN_KEY = 'io.mindroom.bug_reports';

/** Administrators that receive bug reports, from the homeserver's client well-known. */
export const getBugReportAdmins = (info: AutoDiscoveryInfo | null | undefined): string[] => {
  const section = info?.[BUG_REPORTS_WELL_KNOWN_KEY];
  if (!section || typeof section !== 'object' || Array.isArray(section)) return [];
  const { admins } = section as { admins?: unknown };
  if (!Array.isArray(admins)) return [];
  return [
    ...new Set(
      admins.filter((admin): admin is string => typeof admin === 'string' && isUserId(admin))
    ),
  ];
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportConfig.test.ts`
Expected: PASS. If `isUserId` rejects a valid ID in the test, read `matchMxId`/`validMxId` in `src/app/utils/matrix.ts` and adjust the test data to a valid form rather than loosening the parser.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/bug-reports/bugReportConfig.ts src/app/mindroom/bug-reports/bugReportConfig.test.ts
git commit -m "feat(bug-reports): read report admins from the client well-known"
```

---

### Task 3: Report payload builder

**Files:**

- Create: `src/app/mindroom/bug-reports/bugReportPayload.ts`
- Test: `src/app/mindroom/bug-reports/bugReportPayload.test.ts`

**Interfaces:**

- Consumes: `buildDiagnosticsPayload`, `DiagnosticsPayload` (Task 1).
- Produces:

  - `BUG_REPORT_TYPE = 'io.mindroom.bug_report'`, `BUG_REPORT_VERSION = 1`
  - `type BugReportEvent`, `type BugReport`
  - `collectReportEvents(room: Room, mEvent: MatrixEvent): MatrixEvent[]`
  - `buildBugReport(mx: MatrixClient, room: Room, mEvent: MatrixEvent, now?: Date): Promise<BugReport>`
  - `getBugReportFileName(report: BugReport): string`
  - `serializeBugReport(report: BugReport): Blob`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../diagnostics/diagnosticsExport', () => ({
  buildDiagnosticsPayload: vi.fn(async (exportedAt: number) => ({ metadata: { exportedAt } })),
}));

import { buildBugReport, collectReportEvents, getBugReportFileName } from './bugReportPayload';

type FakeEvent = ReturnType<typeof fakeEvent>;

const fakeEvent = (
  id: string,
  ts: number,
  opts: { threadRootId?: string; status?: string | null; edit?: Record<string, unknown> } = {}
) => ({
  getId: () => id,
  getTs: () => ts,
  threadRootId: opts.threadRootId,
  status: opts.status ?? null,
  isDecryptionFailure: () => false,
  getEffectiveEvent: () => ({ event_id: id, origin_server_ts: ts, content: { body: id } }),
  replacingEvent: () => (opts.edit ? { getEffectiveEvent: () => opts.edit } : null),
  isRelation: () => opts.threadRootId !== undefined && opts.threadRootId !== id,
  getRelation: () =>
    opts.threadRootId && opts.threadRootId !== id
      ? { rel_type: 'm.thread', event_id: opts.threadRootId }
      : null,
  getContent: () =>
    opts.threadRootId && opts.threadRootId !== id
      ? { 'm.relates_to': { rel_type: 'm.thread', event_id: opts.threadRootId } }
      : {},
});

const fakeRoom = (opts: {
  live: FakeEvent[];
  thread?: { id: string; root: FakeEvent; events: FakeEvent[] };
  timelineFor?: FakeEvent[];
}) => ({
  roomId: '!room:example.com',
  name: 'Lobby',
  // getState is read by getViaServers (permalink via servers); no state means no via servers.
  getLiveTimeline: () => ({ getEvents: () => opts.live, getState: () => undefined }),
  getTimelineForEvent: () => (opts.timelineFor ? { getEvents: () => opts.timelineFor } : null),
  getThread: (id: string) =>
    opts.thread && opts.thread.id === id
      ? { rootEvent: opts.thread.root, events: opts.thread.events }
      : null,
  findEventById: (id: string) =>
    opts.thread && opts.thread.root.getId() === id ? opts.thread.root : undefined,
  getMembers: () => [],
});

describe('collectReportEvents', () => {
  it('returns the thread root and every known reply, oldest first, without duplicates', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const b = fakeEvent('$b', 3, { threadRootId: '$root' });
    const room = fakeRoom({
      live: [root, b],
      thread: { id: '$root', root, events: [a, b] },
    });
    const ids = collectReportEvents(room as never, b as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$b']);
  });

  it('includes a failed local echo that is only known as the selected event', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const failed = fakeEvent('~!room:example.com:m1', 5, {
      threadRootId: '$root',
      status: 'not_sent',
    });
    const room = fakeRoom({ live: [root], thread: { id: '$root', root, events: [] } });
    const ids = collectReportEvents(room as never, failed as never).map((e) => e.getId());
    expect(ids).toEqual(['$root', '~!room:example.com:m1']);
  });

  it('takes the 50 events up to the selected main-timeline event', () => {
    const events = Array.from({ length: 80 }, (_, i) => fakeEvent(`$e${i}`, i));
    const room = fakeRoom({ live: events, timelineFor: events });
    const ids = collectReportEvents(room as never, events[59] as never).map((e) => e.getId());
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('$e10');
    expect(ids[49]).toBe('$e59');
  });
});

describe('buildBugReport', () => {
  it('captures identifiers, raw events with latest edits, client state, and diagnostics', async () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const reply = fakeEvent('$reply', 2, {
      threadRootId: '$root',
      edit: { event_id: '$edit', content: { 'm.new_content': { body: 'final' } } },
    });
    const room = fakeRoom({ live: [root, reply], thread: { id: '$root', root, events: [reply] } });
    const mx = {
      getSafeUserId: () => '@alice:example.com',
      getDeviceId: () => 'DEVICE',
      getHomeserverUrl: () => 'https://hs.example.com',
      getSyncState: () => 'SYNCING',
    };
    const report = await buildBugReport(
      mx as never,
      room as never,
      reply as never,
      new Date('2026-10-03T12:00:00.000Z')
    );
    expect(report.type).toBe('io.mindroom.bug_report');
    expect(report.version).toBe(1);
    expect(report.reporter).toEqual({
      userId: '@alice:example.com',
      deviceId: 'DEVICE',
      homeserver: 'https://hs.example.com',
    });
    expect(report.target).toMatchObject({
      roomId: '!room:example.com',
      roomName: 'Lobby',
      threadId: '$root',
      eventId: '$reply',
    });
    expect(report.target.permalink).toContain('$reply');
    expect(report.events.map((e) => e.eventId)).toEqual(['$root', '$reply']);
    expect(report.events[1].latestEdit).toEqual({
      event_id: '$edit',
      content: { 'm.new_content': { body: 'final' } },
    });
    expect(report.client.syncState).toBe('SYNCING');
    expect(report.client.platform).toBe('web');
    expect(report.diagnostics).toEqual({
      metadata: { exportedAt: Date.parse('2026-10-03T12:00:00.000Z') },
    });
    expect(getBugReportFileName(report)).toBe('mindroom-bug-report-2026-10-03T12-00-00-000Z.json');
  });
});
```

`getViaServers` (`src/app/plugins/via-servers.ts`) calls `room.getLiveTimeline().getState(…)` and `room.getMembers()`; the fake provides both.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportPayload.test.ts`
Expected: FAIL, cannot resolve `./bugReportPayload`.

- [ ] **Step 3: Implement**

```ts
import { Capacitor } from '@capacitor/core';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { APP_BUILD_VERSION } from '../../../appVersion';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { buildDiagnosticsPayload, type DiagnosticsPayload } from '../diagnostics/diagnosticsExport';
import { getThreadReplyEventsForRoot } from '../threads/threadUtils';

export const BUG_REPORT_TYPE = 'io.mindroom.bug_report';
export const BUG_REPORT_VERSION = 1;
const MAIN_TIMELINE_EVENT_LIMIT = 50;

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

const serializeEvent = (event: MatrixEvent): BugReportEvent => ({
  eventId: event.getId() ?? null,
  status: event.status ?? null,
  decryptionFailure: event.isDecryptionFailure(),
  event: event.getEffectiveEvent() as RawEvent,
  latestEdit: (event.replacingEvent()?.getEffectiveEvent() as RawEvent | undefined) ?? null,
});

/** The events an administrator needs to see the reported message in context. */
export const collectReportEvents = (room: Room, mEvent: MatrixEvent): MatrixEvent[] => {
  const threadId = mEvent.threadRootId;
  if (threadId) {
    const byId = new Map<string, MatrixEvent>();
    const add = (event: MatrixEvent | null | undefined) => {
      const id = event?.getId();
      if (event && id && !byId.has(id)) byId.set(id, event);
    };
    const thread = room.getThread(threadId);
    add(room.findEventById(threadId) ?? thread?.rootEvent);
    (thread?.events ?? []).forEach(add);
    getThreadReplyEventsForRoot(room.getLiveTimeline().getEvents(), threadId).forEach(add);
    add(mEvent);
    return [...byId.values()].sort((a, b) => a.getTs() - b.getTs());
  }

  const eventId = mEvent.getId();
  const timeline = (eventId ? room.getTimelineForEvent(eventId) : null) ?? room.getLiveTimeline();
  const events = timeline.getEvents();
  const index = events.findIndex((event) => event.getId() === eventId);
  if (index === -1) return [...events.slice(-(MAIN_TIMELINE_EVENT_LIMIT - 1)), mEvent];
  return events.slice(Math.max(0, index + 1 - MAIN_TIMELINE_EVENT_LIMIT), index + 1);
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
    events: collectReportEvents(room, mEvent).map(serializeEvent),
    client: buildClientState(mx),
    diagnostics: await buildDiagnosticsPayload(now.getTime()),
  };
};

export const getBugReportFileName = (report: BugReport): string =>
  `mindroom-bug-report-${report.reportedAt.replace(/[:.]/g, '-')}.json`;

export const serializeBugReport = (report: BugReport): Blob =>
  new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
```

`getThreadReplyEventsForRoot` is generic over `ThreadEventLike`; if TypeScript rejects `MatrixEvent[]`, read `ThreadEventLike` in `threadUtils.ts` and cast the argument there rather than changing that util.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportPayload.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/bug-reports/bugReportPayload.ts src/app/mindroom/bug-reports/bugReportPayload.test.ts
git commit -m "feat(bug-reports): build the bug report payload"
```

---

### Task 4: Report room lookup and creation

**Files:**

- Create: `src/app/mindroom/bug-reports/bugReportRoom.ts`
- Test: `src/app/mindroom/bug-reports/bugReportRoom.test.ts`

**Interfaces:**

- Consumes: `waitForJoinedRoom(mx, roomId, timeoutMs?)` from `src/app/mindroom/calls/agentCall.ts`.
- Produces: `BUG_REPORTS_ROOM_TYPE`, `BUG_REPORTS_ACCOUNT_DATA_TYPE` (both `'io.mindroom.bug_reports'`); `ensureBugReportRoom(mx: MatrixClient, admins: string[]): Promise<Room>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ensureBugReportRoom } from './bugReportRoom';

const room = (roomId: string, myMembership: string, members: Record<string, string> = {}) => ({
  roomId,
  getMyMembership: () => myMembership,
  getMember: (userId: string) => (members[userId] ? { membership: members[userId] } : null),
});

const client = (opts: {
  storedRoomId?: string;
  rooms?: Record<string, ReturnType<typeof room>>;
}) => {
  const rooms = { ...(opts.rooms ?? {}) };
  const mx = {
    getSafeUserId: () => '@alice:example.com',
    getUserId: () => '@alice:example.com',
    getUser: () => ({ displayName: 'Alice' }),
    getAccountData: vi.fn(() =>
      opts.storedRoomId ? { getContent: () => ({ room_id: opts.storedRoomId }) } : undefined
    ),
    setAccountData: vi.fn(async () => ({})),
    getRoom: vi.fn((roomId: string) => rooms[roomId] ?? null),
    invite: vi.fn(async () => ({})),
    createRoom: vi.fn(async () => {
      rooms['!new:example.com'] = room('!new:example.com', 'join');
      return { room_id: '!new:example.com' };
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return mx;
};

describe('ensureBugReportRoom', () => {
  it('reuses the stored room and invites only admins who are not already there', async () => {
    const stored = room('!stored:example.com', 'join', {
      '@admin:example.com': 'join',
      '@ops:example.com': 'leave',
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@ops:example.com',
    ]);
    expect(result).toBe(stored);
    expect(mx.createRoom).not.toHaveBeenCalled();
    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.invite).toHaveBeenCalledWith('!stored:example.com', '@ops:example.com');
  });

  it('creates a private, typed, unencrypted room when the stored room was left', async () => {
    const mx = client({
      storedRoomId: '!old:example.com',
      rooms: { '!old:example.com': room('!old:example.com', 'leave') },
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@alice:example.com',
    ]);
    expect(result.roomId).toBe('!new:example.com');
    const request = mx.createRoom.mock.calls[0][0] as Record<string, unknown>;
    expect(request).toMatchObject({
      name: 'Bug reports · Alice',
      preset: 'private_chat',
      visibility: 'private',
      invite: ['@admin:example.com'],
      creation_content: { type: 'io.mindroom.bug_reports' },
    });
    expect(JSON.stringify(request)).not.toContain('m.room.encryption');
    expect(mx.setAccountData).toHaveBeenCalledWith('io.mindroom.bug_reports', {
      room_id: '!new:example.com',
    });
  });

  it('shares one in-flight lookup so concurrent reports create one room', async () => {
    const mx = client({});
    const [first, second] = await Promise.all([
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
    ]);
    expect(first).toBe(second);
    expect(mx.createRoom).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportRoom.test.ts`
Expected: FAIL, cannot resolve `./bugReportRoom`.

- [ ] **Step 3: Implement**

```ts
import { Preset, Visibility, type MatrixClient, type Room } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { waitForJoinedRoom } from '../calls/agentCall';

export const BUG_REPORTS_ROOM_TYPE = 'io.mindroom.bug_reports';
export const BUG_REPORTS_ACCOUNT_DATA_TYPE = 'io.mindroom.bug_reports';

const inFlight = new WeakMap<MatrixClient, Promise<Room>>();

const getStoredRoomId = (mx: MatrixClient): string | undefined => {
  const content = mx
    .getAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never)
    ?.getContent<{ room_id?: unknown }>();
  return typeof content?.room_id === 'string' ? content.room_id : undefined;
};

const inviteMissingAdmins = async (mx: MatrixClient, room: Room, admins: string[]) => {
  const missing = admins.filter((userId) => {
    const membership = room.getMember(userId)?.membership;
    return membership !== Membership.Join && membership !== Membership.Invite;
  });
  await Promise.all(missing.map((userId) => mx.invite(room.roomId, userId)));
};

const createReportRoom = async (mx: MatrixClient, admins: string[]): Promise<Room> => {
  const userId = mx.getSafeUserId();
  const displayName = mx.getUser(userId)?.displayName ?? getMxIdLocalPart(userId) ?? userId;
  // No m.room.encryption: matrix-mcp, which coding agents use to read reports, has no E2EE.
  const { room_id: roomId } = await mx.createRoom({
    name: `Bug reports · ${displayName}`,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    invite: admins,
    creation_content: { type: BUG_REPORTS_ROOM_TYPE },
  });
  await mx.setAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never, { room_id: roomId } as never);
  return waitForJoinedRoom(mx, roomId);
};

/** The reporter's private room with the administrators, created on first use. */
export const ensureBugReportRoom = (mx: MatrixClient, admins: string[]): Promise<Room> => {
  const pending = inFlight.get(mx);
  if (pending) return pending;

  const myUserId = mx.getSafeUserId();
  const otherAdmins = admins.filter((userId) => userId !== myUserId);
  const lookup = (async () => {
    const storedRoomId = getStoredRoomId(mx);
    const stored = storedRoomId ? mx.getRoom(storedRoomId) : null;
    if (stored && stored.getMyMembership() === Membership.Join) {
      await inviteMissingAdmins(mx, stored, otherAdmins);
      return stored;
    }
    return createReportRoom(mx, otherAdmins);
  })().finally(() => inFlight.delete(mx));
  inFlight.set(mx, lookup);
  return lookup;
};
```

Check `Membership` in `src/types/matrix/room.ts` has `Join`, `Invite` (it is used that way in `MindroomClientNonUIFeatures.tsx`). `waitForJoinedRoom` returns the room immediately when `mx.getRoom` already knows it, which the fake client does after `createRoom`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/mindroom/bug-reports/bugReportRoom.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/bug-reports/bugReportRoom.ts src/app/mindroom/bug-reports/bugReportRoom.test.ts
git commit -m "feat(bug-reports): find or create the reporter's private report room"
```

---

### Task 5: Sending the report

**Files:**

- Create: `src/app/mindroom/bug-reports/sendBugReport.ts`
- Test: `src/app/mindroom/bug-reports/sendBugReport.test.ts`

**Interfaces:**

- Consumes: `BugReport`, `BUG_REPORT_TYPE`, `getBugReportFileName`, `serializeBugReport` (Task 3); `getFileMsgContent(item, mxc)` from `src/app/features/room/msgContent.ts`; `encryptFile(file)` from `src/app/utils/matrix.ts`; `getMessageRelation(undefined, undefined, threadId)` from `src/app/mindroom/threads/composeMessageRelation.ts`.
- Produces: `buildBugReportSummary(report: BugReport, reporterName: string): string`; `sendBugReport(mx: MatrixClient, reportRoom: Room, report: BugReport): Promise<{ roomId: string; threadRootId: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/matrix')>()),
  encryptFile: vi.fn(async (file: File) => ({
    encInfo: { key: { k: 'secret' }, iv: 'iv', hashes: { sha256: 'h' }, v: 'v2' },
    file,
    originalFile: file,
  })),
}));

import type { BugReport } from './bugReportPayload';
import { buildBugReportSummary, sendBugReport } from './sendBugReport';

const report = {
  type: 'io.mindroom.bug_report',
  version: 1,
  reportedAt: '2026-10-03T12:00:00.000Z',
  reporter: { userId: '@alice:example.com', deviceId: 'D', homeserver: 'https://hs' },
  target: {
    roomId: '!r:example.com',
    roomName: 'Lobby',
    threadId: '$root',
    eventId: '$reply',
    permalink: 'https://chat.example/#/!r:example.com/$reply',
  },
  events: [],
  client: { build: 'abc123', platform: 'ios' },
  diagnostics: {},
} as unknown as BugReport;

const client = () => ({
  getSafeUserId: () => '@alice:example.com',
  getUser: () => ({ displayName: 'Alice' }),
  sendMessage: vi.fn(async (_roomId: string, threadIdOrContent: unknown) =>
    threadIdOrContent && typeof threadIdOrContent === 'object'
      ? { event_id: '$summary' }
      : { event_id: '$file' }
  ),
  uploadContent: vi.fn(async () => ({ content_uri: 'mxc://example.com/abc' })),
});

describe('buildBugReportSummary', () => {
  it('lists who, where, and which client, with permalinks', () => {
    const summary = buildBugReportSummary(report, 'Alice');
    expect(summary).toContain('Bug report from Alice (@alice:example.com)');
    expect(summary).toContain('Message: https://chat.example/#/!r:example.com/$reply');
    expect(summary).toContain('Thread: ');
    expect(summary).toContain('Room: Lobby');
    expect(summary).toContain('Client: MindRoom Chat abc123 (ios)');
  });
});

describe('sendBugReport', () => {
  it('posts the summary root and the JSON file as a reply in its thread', async () => {
    const mx = client();
    const reportRoom = { roomId: '!reports:example.com', hasEncryptionStateEvent: () => false };
    const result = await sendBugReport(mx as never, reportRoom as never, report);
    expect(result).toEqual({ roomId: '!reports:example.com', threadRootId: '$summary' });

    const [summaryRoomId, summaryContent] = mx.sendMessage.mock.calls[0];
    expect(summaryRoomId).toBe('!reports:example.com');
    expect(summaryContent).toMatchObject({
      msgtype: 'm.text',
      'io.mindroom.bug_report': {
        version: 1,
        room_id: '!r:example.com',
        thread_id: '$root',
        event_id: '$reply',
      },
    });

    const [fileRoomId, fileThreadId, fileContent] = mx.sendMessage.mock.calls[1];
    expect(fileRoomId).toBe('!reports:example.com');
    expect(fileThreadId).toBe('$summary');
    expect(fileContent).toMatchObject({
      msgtype: 'm.file',
      body: 'mindroom-bug-report-2026-10-03T12-00-00-000Z.json',
      url: 'mxc://example.com/abc',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$summary' },
    });
  });

  it('encrypts the file when the report room is encrypted', async () => {
    const mx = client();
    const reportRoom = { roomId: '!reports:example.com', hasEncryptionStateEvent: () => true };
    await sendBugReport(mx as never, reportRoom as never, report);
    const fileContent = mx.sendMessage.mock.calls[1][2] as Record<string, unknown>;
    expect(fileContent.url).toBeUndefined();
    expect(fileContent.file).toMatchObject({ url: 'mxc://example.com/abc', iv: 'iv' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/sendBugReport.test.ts`
Expected: FAIL, cannot resolve `./sendBugReport`.

- [ ] **Step 3: Implement**

```ts
import { MsgType, type MatrixClient, type Room, type RoomMessageEventContent } from 'matrix-js-sdk';
import { getFileMsgContent } from '../../features/room/msgContent';
import { encryptFile, getMxIdLocalPart } from '../../utils/matrix';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getMessageRelation } from '../threads/composeMessageRelation';
import {
  BUG_REPORT_TYPE,
  BUG_REPORT_VERSION,
  getBugReportFileName,
  serializeBugReport,
  type BugReport,
} from './bugReportPayload';

/** English on purpose: Matrix content is read by administrators and agents, not localized. */
export const buildBugReportSummary = (report: BugReport, reporterName: string): string => {
  const { target, reporter, client } = report;
  const lines = [
    `Bug report from ${reporterName} (${reporter.userId})`,
    `Message: ${target.permalink}`,
  ];
  if (target.threadId) {
    lines.push(`Thread: ${getMatrixToRoomEvent(target.roomId, target.threadId)}`);
  }
  lines.push(
    `Room: ${target.roomName}`,
    `Client: MindRoom Chat ${client.build} (${client.platform})`,
    'The debug data is attached below. Add any details in this thread.'
  );
  return lines.join('\n');
};

const uploadReportFile = async (mx: MatrixClient, reportRoom: Room, report: BugReport) => {
  const fileName = getBugReportFileName(report);
  const plain = new File([serializeBugReport(report)], fileName, { type: 'application/json' });
  const item = reportRoom.hasEncryptionStateEvent()
    ? { ...(await encryptFile(plain)), metadata: { markedAsSpoiler: false } }
    : {
        file: plain,
        originalFile: plain,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false },
      };
  const { content_uri: mxc } = await mx.uploadContent(item.file, {
    name: fileName,
    type: item.encInfo ? 'application/octet-stream' : 'application/json',
    includeFilename: !item.encInfo,
  });
  return getFileMsgContent(item as never, mxc);
};

export const sendBugReport = async (
  mx: MatrixClient,
  reportRoom: Room,
  report: BugReport
): Promise<{ roomId: string; threadRootId: string }> => {
  const userId = mx.getSafeUserId();
  const reporterName = mx.getUser(userId)?.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const { event_id: threadRootId } = await mx.sendMessage(reportRoom.roomId, {
    msgtype: MsgType.Text,
    body: buildBugReportSummary(report, reporterName),
    [BUG_REPORT_TYPE]: {
      version: BUG_REPORT_VERSION,
      room_id: report.target.roomId,
      thread_id: report.target.threadId,
      event_id: report.target.eventId,
    },
  } as RoomMessageEventContent);

  const fileContent = await uploadReportFile(mx, reportRoom, report);
  await mx.sendMessage(reportRoom.roomId, threadRootId, {
    ...fileContent,
    'm.relates_to': getMessageRelation(undefined, undefined, threadRootId),
  } as RoomMessageEventContent);

  return { roomId: reportRoom.roomId, threadRootId };
};
```

Read `TUploadItem`/`TUploadMetadata` in `src/app/state/room/roomInputDrafts.ts`; if `metadata` needs more fields, set them to their "off" values and drop the `as never` cast on `getFileMsgContent` once the object matches the type. Read `getMessageRelation`'s return for a thread-only call and confirm it yields `{ rel_type: 'm.thread', event_id, is_falling_back: true, 'm.in_reply_to': … }` or similar; the test only asserts `rel_type` and `event_id`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/mindroom/bug-reports/sendBugReport.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/mindroom/bug-reports/sendBugReport.ts src/app/mindroom/bug-reports/sendBugReport.test.ts
git commit -m "feat(bug-reports): send the summary and JSON into a report thread"
```

---

### Task 6: Menu item, strings, and wiring

**Files:**

- Create: `src/app/mindroom/bug-reports/MessageBugReportItem.tsx`
- Test: `src/app/mindroom/bug-reports/MessageBugReportItem.test.tsx`
- Modify: `src/app/mindroom/messages/MindroomMessage.tsx` (menu block around the `MessagePinItem` render, ~line 572)
- Modify: `src/app/locales/en.json` and the 16 other `src/app/locales/*.json`

**Interfaces:**

- Consumes: `getBugReportAdmins` (Task 2); `buildBugReport`, `getBugReportFileName`, `serializeBugReport` (Task 3); `ensureBugReportRoom` (Task 4); `sendBugReport` (Task 5); `useAutoDiscoveryInfo()`; `useRoomNavigate().navigateRoomThread(roomId, threadId)`; `saveFile(blob, fileName)` from `src/app/mindroom/native/nativeFileSave.ts`.
- Produces: `MessageBugReportItem` (`as<'button', { room: Room; mEvent: MatrixEvent; onClose?: () => void }>`).

- [ ] **Step 1: Add the strings** — in `src/app/locales/en.json`, inside `mindroomUi.messages` next to `"messageInspectionActions"`, add:

```json
      "bugReport": {
        "report": "Report a bug",
        "download": "Download bug report",
        "sending": "Sending report…",
        "failed": "Couldn't send the report. Try again."
      },
```

Add the same four keys, translated, to each of the other 16 catalogs (`ar bn de es fr hi id it ja ko nl pt ru tr zh zh-TW`) at the same path. Use natural full-sentence translations; keep the ellipsis character.

- [ ] **Step 2: Write the failing test**

```tsx
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discovery: {} as Record<string, unknown>,
  navigateRoomThread: vi.fn(),
  buildBugReport: vi.fn(async () => ({ reportedAt: '2026-10-03T12:00:00.000Z' })),
  ensureBugReportRoom: vi.fn(async () => ({ roomId: '!reports:example.com' })),
  sendBugReport: vi.fn(async () => ({ roomId: '!reports:example.com', threadRootId: '$summary' })),
  saveFile: vi.fn(async () => true),
}));

vi.mock('folds', () => ({
  as: (render: (props: object, ref: React.Ref<unknown>) => React.ReactNode) =>
    React.forwardRef((props, ref) => render(props, ref)),
  Icon: () => null,
  Icons: { Warning: 'warning' },
  MenuItem: React.forwardRef(
    ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>, ref) => (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    )
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../features/room/message/styles.css', () => ({ MessageMenuItemText: 'text' }));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: () => mocks.discovery,
}));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: mocks.navigateRoomThread }),
}));
vi.mock('../native/nativeFileSave', () => ({ saveFile: mocks.saveFile }));
vi.mock('./bugReportPayload', () => ({
  buildBugReport: mocks.buildBugReport,
  getBugReportFileName: () => 'report.json',
  serializeBugReport: () => new Blob(['{}']),
}));
vi.mock('./bugReportRoom', () => ({ ensureBugReportRoom: mocks.ensureBugReportRoom }));
vi.mock('./sendBugReport', () => ({ sendBugReport: mocks.sendBugReport }));

import { MessageBugReportItem } from './MessageBugReportItem';

const strings = {
  mindroomUi: {
    messages: {
      bugReport: {
        report: 'Report a bug',
        download: 'Download bug report',
        sending: 'Sending report…',
        failed: "Couldn't send the report. Try again.",
      },
    },
  },
};

const render = async (onClose = vi.fn()) => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: strings } },
  });
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <I18nextProvider i18n={i18n}>
        <MessageBugReportItem room={{} as never} mEvent={{} as never} onClose={onClose} />
      </I18nextProvider>
    );
  });
  return renderer;
};

const text = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByType('button').findByType('span').props.children;

describe('MessageBugReportItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discovery = {};
  });

  it('sends the report and opens its thread when admins are configured', async () => {
    mocks.discovery = { 'io.mindroom.bug_reports': { admins: ['@admin:example.com'] } };
    const onClose = vi.fn();
    const renderer = await render(onClose);
    expect(text(renderer)).toBe('Report a bug');
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(mocks.ensureBugReportRoom).toHaveBeenCalledWith({}, ['@admin:example.com']);
    expect(mocks.sendBugReport).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith('!reports:example.com', '$summary');
  });

  it('downloads the report when no admins are configured', async () => {
    const renderer = await render();
    expect(text(renderer)).toBe('Download bug report');
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(mocks.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'report.json');
    expect(mocks.ensureBugReportRoom).not.toHaveBeenCalled();
  });

  it('shows a retryable error when sending fails', async () => {
    mocks.discovery = { 'io.mindroom.bug_reports': { admins: ['@admin:example.com'] } };
    mocks.sendBugReport.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onClose = vi.fn();
    const renderer = await render(onClose);
    await act(async () => {
      await renderer.root.findByType('button').props.onClick();
    });
    expect(text(renderer)).toBe("Couldn't send the report. Try again.");
    expect(renderer.root.findByType('button').props.disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

If `MenuItem` is imported from `../../components/glass/GlassPrimitives` (as `MessageInspectionActions.tsx` does) and that module needs more `folds` exports than mocked, add the missing names to the `folds` mock exactly like `MessageInspectionActions.test.tsx` does.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/MessageBugReportItem.test.tsx`
Expected: FAIL, cannot resolve `./MessageBugReportItem`.

- [ ] **Step 4: Implement**

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text, as } from 'folds';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import * as css from '../../features/room/message/styles.css';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { saveFile } from '../native/nativeFileSave';
import { getBugReportAdmins } from './bugReportConfig';
import { buildBugReport, getBugReportFileName, serializeBugReport } from './bugReportPayload';
import { ensureBugReportRoom } from './bugReportRoom';
import { sendBugReport } from './sendBugReport';

type SendState = 'idle' | 'sending' | 'error';

export const MessageBugReportItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  // Read on every render: the well-known fetch may finish after the timeline mounts.
  const admins = getBugReportAdmins(useAutoDiscoveryInfo());
  const { navigateRoomThread } = useRoomNavigate();
  const [state, setState] = useState<SendState>('idle');

  const handleClick = async () => {
    if (state === 'sending') return;
    setState('sending');
    try {
      const report = await buildBugReport(mx, room, mEvent);
      if (admins.length === 0) {
        await saveFile(serializeBugReport(report), getBugReportFileName(report));
        setState('idle');
        onClose?.();
        return;
      }
      const reportRoom = await ensureBugReportRoom(mx, admins);
      const { roomId, threadRootId } = await sendBugReport(mx, reportRoom, report);
      onClose?.();
      navigateRoomThread(roomId, threadRootId);
    } catch (error) {
      console.warn('[bug-report] could not send the report', error);
      setState('error');
    }
  };

  let label =
    admins.length > 0
      ? t('mindroomUi.messages.bugReport.report')
      : t('mindroomUi.messages.bugReport.download');
  if (state === 'sending') label = t('mindroomUi.messages.bugReport.sending');
  if (state === 'error') label = t('mindroomUi.messages.bugReport.failed');

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Warning} />}
      radii="300"
      onClick={handleClick}
      disabled={state === 'sending'}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );
});
```

Run `npm run lint` on the file; if the repo's lint config flags `console.warn` or the `let` reassignment, follow the closest existing pattern in `src/app/mindroom/messages/` (for example an `eslint-disable-next-line no-console` comment or a small `getLabel()` helper) instead of disabling rules broadly.

- [ ] **Step 5: Wire it into the message menu** — in `src/app/mindroom/messages/MindroomMessage.tsx`, import it and render it as the last item of the first menu group, right after the `MessagePinItem` block:

```tsx
import { MessageBugReportItem } from '../bug-reports/MessageBugReportItem';
```

```tsx
{
  serverEventActionsAllowed && canPinEvent && (
    <MessagePinItem room={room} mEvent={mEvent} onClose={closeMenu} />
  );
}
<MessageBugReportItem room={room} mEvent={mEvent} onClose={closeMenu} />;
```

It is deliberately not gated on `serverEventActionsAllowed`: failed and pending local echoes are prime bug-report targets.

- [ ] **Step 6: Run tests, i18n coverage, architecture tests, typecheck, lint**

Run: `npx vitest run src/app/mindroom/bug-reports src/app/i18n.test.ts src/app/mindroom/threads/__tests__/featureOwnership.architecture.test.ts src/app/mindroom/threads/__tests__/forkOwnership.architecture.test.ts && npm run typecheck && npm run lint`
Expected: all PASS; lint has no new errors.
If the architecture test reports a dependency cycle through the new module, break it by importing the narrower module the cycle passes through (do not add exceptions to the test).

- [ ] **Step 7: Commit**

```bash
git add src/app/mindroom/bug-reports/MessageBugReportItem.tsx src/app/mindroom/bug-reports/MessageBugReportItem.test.tsx src/app/mindroom/messages/MindroomMessage.tsx src/app/locales/*.json
git commit -m "feat(bug-reports): add one-click Report a bug to the message menu"
```

---

### Task 7: Administrator auto-join

**Files:**

- Create: `src/app/mindroom/bug-reports/BugReportAutoJoinFeature.tsx`
- Test: `src/app/mindroom/bug-reports/BugReportAutoJoinFeature.test.ts`
- Modify: `src/app/mindroom/client/MindroomClientNonUIFeatures.tsx` (`MindroomClientNonUIFeatures` at the end of the file)

**Interfaces:**

- Consumes: `getBugReportAdmins` (Task 2); `BUG_REPORTS_ROOM_TYPE` (Task 4); `allInvitesAtom` from `src/app/state/room-list/inviteList.ts`; `getStateEvent` from `src/app/utils/room.ts`; `getMxIdServer` from `src/app/utils/matrix.ts`.
- Produces: `shouldAutoJoinBugReportInvite(mx: MatrixClient, room: Room | null, admins: string[]): boolean`; `BugReportAutoJoinFeature()` (renders `null`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { shouldAutoJoinBugReportInvite } from './BugReportAutoJoinFeature';

const mx = (userId = '@admin:example.com') => ({ getUserId: () => userId });

const invitedRoom = (opts: { type?: string; inviter?: string; membership?: string } = {}) => ({
  getMyMembership: () => opts.membership ?? 'invite',
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (eventType: string) =>
        eventType === 'm.room.create'
          ? { getContent: () => ({ type: opts.type ?? 'io.mindroom.bug_reports' }) }
          : null,
    }),
  }),
  getMember: () => ({
    events: { member: { getSender: () => opts.inviter ?? '@alice:example.com' } },
  }),
});

const admins = ['@admin:example.com'];

describe('shouldAutoJoinBugReportInvite', () => {
  it('joins report rooms from reporters on the same homeserver', () => {
    expect(shouldAutoJoinBugReportInvite(mx() as never, invitedRoom() as never, admins)).toBe(true);
  });

  it('ignores users who are not configured admins', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx('@bob:example.com') as never, invitedRoom() as never, admins)
    ).toBe(false);
  });

  it('ignores other room types', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ type: 'm.space' }) as never,
        admins
      )
    ).toBe(false);
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ type: undefined, inviter: '@a:example.com' }) as never,
        []
      )
    ).toBe(false);
  });

  it('ignores inviters from other homeservers', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ inviter: '@mallory:evil.example' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores rooms that are not pending invites', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ membership: 'join' }) as never,
        admins
      )
    ).toBe(false);
    expect(shouldAutoJoinBugReportInvite(mx() as never, null, admins)).toBe(false);
  });
});
```

Before running, read `getStateEvent` in `src/app/utils/room.ts` and make `invitedRoom` provide exactly the methods it calls (the fake above assumes `room.getLiveTimeline().getState(…).getStateEvents(type, stateKey)`; adjust the fake, not the production code, if it differs).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/mindroom/bug-reports/BugReportAutoJoinFeature.test.ts`
Expected: FAIL, cannot resolve `./BugReportAutoJoinFeature`.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { Membership, StateEvent } from '../../../types/matrix/room';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { getMxIdServer } from '../../utils/matrix';
import { getStateEvent } from '../../utils/room';
import { getBugReportAdmins } from './bugReportConfig';
import { BUG_REPORTS_ROOM_TYPE } from './bugReportRoom';

/** Admins join report rooms without accepting invites; only from reporters on their own homeserver. */
export const shouldAutoJoinBugReportInvite = (
  mx: MatrixClient,
  room: Room | null,
  admins: string[]
): boolean => {
  const myUserId = mx.getUserId();
  if (!room || !myUserId || !admins.includes(myUserId)) return false;
  if (room.getMyMembership() !== Membership.Invite) return false;
  if (getStateEvent(room, StateEvent.RoomCreate)?.getContent().type !== BUG_REPORTS_ROOM_TYPE) {
    return false;
  }
  const inviter = room.getMember(myUserId)?.events.member?.getSender();
  return !!inviter && getMxIdServer(inviter) === getMxIdServer(myUserId);
};

export function BugReportAutoJoinFeature() {
  const mx = useMatrixClient();
  const invites = useAtomValue(allInvitesAtom);
  const discovery = useAutoDiscoveryInfo();
  const admins = useMemo(() => getBugReportAdmins(discovery), [discovery]);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    invites.forEach((roomId) => {
      if (attempted.current.has(roomId)) return;
      if (!shouldAutoJoinBugReportInvite(mx, mx.getRoom(roomId), admins)) return;
      attempted.current.add(roomId);
      mx.joinRoom(roomId).catch((error: unknown) => {
        console.warn('[bug-report] could not auto-join report room', roomId, error);
      });
    });
  }, [mx, invites, admins]);

  return null;
}
```

- [ ] **Step 4: Mount it** — in `src/app/mindroom/client/MindroomClientNonUIFeatures.tsx`:

```tsx
import { BugReportAutoJoinFeature } from '../bug-reports/BugReportAutoJoinFeature';
```

```tsx
export function MindroomClientNonUIFeatures() {
  useModelControllerLifetime();
  return (
    <>
      <CrossRoomThreadIndexFeature />
      <MindroomFaviconUpdater />
      <MindroomInviteNotifications />
      <MindroomNativeIOSPushFeature />
      <BugReportAutoJoinFeature />
    </>
  );
}
```

If `MindroomClientNonUIFeatures.test.ts` renders `MindroomClientNonUIFeatures` without an `AutoDiscoveryInfoProvider`, wrap its render in `<AutoDiscoveryInfoProvider value={{ 'm.homeserver': { base_url: 'https://hs.example' } }}>` (from `src/app/hooks/useAutoDiscoveryInfo.ts`) instead of making the hook optional.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npx vitest run src/app/mindroom/bug-reports src/app/mindroom/client src/app/mindroom/threads/__tests__ && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/mindroom/bug-reports/BugReportAutoJoinFeature.tsx src/app/mindroom/bug-reports/BugReportAutoJoinFeature.test.ts src/app/mindroom/client/MindroomClientNonUIFeatures.tsx
git commit -m "feat(bug-reports): auto-join report rooms for configured admins"
```

Include `src/app/mindroom/client/MindroomClientNonUIFeatures.test.ts` in the `git add` if Step 4 changed it.

---

### Task 8: Operator docs, runbook, full validation

**Files:**

- Create: `docs/bug-reports.md`
- Modify: `FORK_CHANGES.md` (new entry directly under `## Runbook`)

- [ ] **Step 1: Write `docs/bug-reports.md`** (one sentence per line):

````markdown
# Bug reports

Every message menu has **Report a bug**.
One click sends a JSON report to the deployment's administrators and opens the report thread, where the reporter can add details.

## Enable it

Add the administrators to the homeserver's `/.well-known/matrix/client`:

```json
{
  "m.homeserver": { "base_url": "https://matrix.example.com" },
  "io.mindroom.bug_reports": { "admins": ["@admin:example.com"] }
}
```

The document must be served with `Access-Control-Allow-Origin: *`, as Matrix clients already require.
Without the key, the menu item is labelled **Download bug report** and saves the JSON instead.

## What happens

- The reporter gets one private room, `Bug reports · <name>`, shared only with the administrators; each report is a thread in it.
- The room has type `io.mindroom.bug_reports` and is created unencrypted so `matrix-mcp` can read it.
- Administrators' MindRoom Chat clients join these rooms automatically when the inviter is on the same homeserver.
- The room ID is kept in the reporter's account data `io.mindroom.bug_reports`; leaving the room makes the next report create a new one.

## What a report contains

- The room, thread, and message IDs and permalinks.
- The raw events of the thread (or the 50 main-timeline events up to the message), each with its latest edit and local send status.
- Client build, platform, browser, viewport, sync state, and URL.
- The same diagnostics as **Settings → About → Export diagnostics**.

Nothing is redacted: administrators are trusted with everything, and users never see each other's reports.

## Backend data

Run `mindroom debug-report <report.json>` on the MindRoom host to collect the backend side (turn records, Agno runs, tool calls, LLM request logs, and log lines) for the same identifiers.
````

- [ ] **Step 2: Add the runbook entry** at the top of `## Runbook` in `FORK_CHANGES.md`, following the format of the entries below it (one sentence per line):

```markdown
### Add one-click bug reports (2026-10-03)

- Every message menu has **Report a bug**; one click builds a JSON report and sends it to the administrators named in the homeserver's client well-known (`io.mindroom.bug_reports.admins`).
- The report goes to the reporter's private room with the administrators (`io.mindroom.bug_reports` room type, unencrypted, ID kept in account data), as a summary message with the JSON attached in its thread, and the app opens that thread so the reporter can add details.
- Administrators' clients join these rooms automatically, only when the inviter is on their own homeserver.
- Without configured administrators the item downloads the JSON instead.
- The report holds the target IDs and permalinks, the raw thread events with latest edits and send status, client state, and the existing diagnostics payload (`buildDiagnosticsPayload`, split out of `buildDiagnosticsExport`).
- Code lives in `src/app/mindroom/bug-reports/`; operator setup is in `docs/bug-reports.md`; the 16 non-English strings are machine-authored.
- Validation: the bug-report unit tests, i18n coverage, architecture tests, typecheck, lint, and build pass.
- Next: add `io.mindroom.bug_reports` to a deployment's well-known and confirm a report from an iPhone reaches the administrator's client without an invite prompt.
```

- [ ] **Step 3: Full validation**

Run: `npm run typecheck && npm run lint && npm run build && npx vitest run src/app/mindroom src/app/i18n.test.ts`
Expected: all PASS (record pre-existing failures, if any, by re-running the same command on `origin/dev` before claiming they are unrelated).

- [ ] **Step 4: Commit**

```bash
git add docs/bug-reports.md FORK_CHANGES.md
git commit -m "docs: document one-click bug reports"
```

---

### Task 9: Live end-to-end check against a real homeserver

**Files:**

- Create: `e2e/bug-report.spec.ts`

**Interfaces:**

- Consumes: the whole feature; e2e helpers `getHomeserver`, `getPrimaryCredentials`, `getSecondaryCredentials` (`e2e/env.ts`), `loginWithPassword`, `setFullInterfaceModeForCredentials`, `expectLoggedInShellStable` (`e2e/helpers/auth.ts`), `loginToMatrix`, `createPrivateRoom`, `sendRoomMessage`, `matrixFetch` (`e2e/helpers/matrix.ts`), `attachBrowserDiagnostics`/`expectNoUnexpectedBrowserDiagnostics` (`e2e/helpers/browserDiagnostics.ts`).
- Produces: a Playwright spec run by `npm run test:e2e:docker-matrix` (Docker Tuwunel at `http://127.0.0.1:28008`, server name `matrix.localhost`, with `E2E_*` and `E2E_SECOND_*` accounts).

Why: the spec's Testing section requires a live check with a reporter and an administrator. Unit tests mock the Matrix client; only a real homeserver proves room creation, invites, auto-join, uploads, and navigation work together.

The client fetches `https://matrix.localhost/.well-known/matrix/client` (the server name of `@user:matrix.localhost`), which does not resolve in the Docker stack, so the spec intercepts it with `context.route` and serves the administrators key. This is test scaffolding only; no production code changes.

- [ ] **Step 1: Write the spec** with this shape (adapt selectors to the real DOM; read `e2e/account-switching.spec.ts` and one spec that opens a live room for patterns):

```ts
import { expect, test, type BrowserContext } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, getSecondaryCredentials } from './env';
import {
  expectLoggedInShellStable,
  loginWithPassword,
  setFullInterfaceModeForCredentials,
} from './helpers/auth';
import { createPrivateRoom, loginToMatrix, matrixFetch, sendRoomMessage } from './helpers/matrix';

const serveBugReportWellKnown = async (
  context: BrowserContext,
  homeserver: string,
  admin: string
) => {
  await context.route('**/.well-known/matrix/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        'm.homeserver': { base_url: homeserver },
        'io.mindroom.bug_reports': { admins: [admin] },
      }),
    })
  );
};

test('one click sends a bug report the administrator receives without accepting an invite', async ({
  browser,
}) => {
  const adminCredentials = getSecondaryCredentials();
  test.skip(
    !adminCredentials,
    'Set E2E_SECOND_USERNAME and E2E_SECOND_PASSWORD to run the bug report e2e flow.'
  );
  test.slow();
  const homeserver = getHomeserver();
  const reporterCredentials = getPrimaryCredentials();
  const reporter = await loginToMatrix(
    homeserver,
    reporterCredentials.username,
    reporterCredentials.password
  );
  const admin = await loginToMatrix(
    homeserver,
    adminCredentials!.username,
    adminCredentials!.password
  );
  await Promise.all([
    setFullInterfaceModeForCredentials(homeserver, reporterCredentials),
    setFullInterfaceModeForCredentials(homeserver, adminCredentials!),
  ]);

  // A private room the administrator is NOT in: the report must still reach them.
  const marker = `bug report e2e ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, reporter.accessToken, {
    name: `Bug report source ${Date.now()}`,
  });
  await sendRoomMessage(/* homeserver, reporter.accessToken, roomId, marker — match the helper's real signature */);

  // Administrator signs in first so its client is running when the invite arrives.
  const adminContext = await browser.newContext();
  await serveBugReportWellKnown(adminContext, homeserver, admin.userId);
  const adminPage = await adminContext.newPage();
  await loginWithPassword(adminPage, { homeserver, ...adminCredentials! });
  await expectLoggedInShellStable(adminPage);

  const reporterContext = await browser.newContext();
  await serveBugReportWellKnown(reporterContext, homeserver, admin.userId);
  const reporterPage = await reporterContext.newPage();
  await loginWithPassword(reporterPage, { homeserver, ...reporterCredentials });
  await expectLoggedInShellStable(reporterPage);

  // Open the source room, open the marker message's menu, click Report a bug.
  // (Navigate to the room by its route or the room list; hover the message and open its options menu.)
  await reporterPage.getByRole('menuitem', { name: 'Report a bug' }).click();

  // The reporter lands in the report thread with the summary and the attached JSON.
  await expect(reporterPage).toHaveURL(/threadId=/);
  await expect(reporterPage.getByText(/Bug report from/).first()).toBeVisible();
  await expect(reporterPage.getByText(/mindroom-bug-report-.*\.json/).first()).toBeVisible();

  // The report room is recorded in account data, typed, unencrypted, and the administrator joined it unprompted.
  const { room_id: reportRoomId } = await matrixFetch<{ room_id: string }>(
    homeserver,
    `/user/${encodeURIComponent(reporter.userId)}/account_data/io.mindroom.bug_reports`,
    { accessToken: reporter.accessToken }
  );
  const create = await matrixFetch<{ type?: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(reportRoomId)}/state/m.room.create/`,
    { accessToken: reporter.accessToken }
  );
  expect(create.type).toBe('io.mindroom.bug_reports');
  await expect
    .poll(
      async () => {
        const { joined_rooms } = await matrixFetch<{ joined_rooms: string[] }>(
          homeserver,
          '/joined_rooms',
          {
            accessToken: admin.accessToken,
          }
        );
        return joined_rooms.includes(reportRoomId);
      },
      { timeout: 30_000 }
    )
    .toBe(true);

  // A second report reuses the same room.
  // (Report the same message again from the source room and assert the account data room_id is unchanged.)

  await reporterContext.close();
  await adminContext.close();
});
```

Also assert that `/rooms/{reportRoomId}/state/m.room.encryption/` returns 404 (unencrypted); `matrixFetch` throws on non-2xx, so wrap it and check the error carries 404/`M_NOT_FOUND`.

- [ ] **Step 2: Run it against the Docker homeserver**

Run: `E2E_MATRIX_AUTO_DOWN=1 npm run test:e2e:docker-matrix -- e2e/bug-report.spec.ts`
Expected: PASS. If the script runs more than the given spec, read `scripts/test-e2e-docker-matrix.sh` and pass the spec path the way it expects. If the Docker stack cannot start, report BLOCKED with the exact error.
If the spec fails, it is a real integration bug until proven otherwise: report the failure with evidence (trace/screenshot path) as DONE_WITH_CONCERNS rather than weakening assertions.

- [ ] **Step 3: Commit**

```bash
git add e2e/bug-report.spec.ts
git commit -m "test(e2e): cover one-click bug reports against a real homeserver"
```
