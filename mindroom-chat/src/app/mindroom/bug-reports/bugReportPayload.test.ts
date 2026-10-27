// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../diagnostics/diagnosticsExport', () => ({
  buildDiagnosticsPayload: vi.fn(async (exportedAt: number) => ({ metadata: { exportedAt } })),
}));

import {
  buildBugReport,
  collectReportEvents,
  getBugReportFileName,
  serializeBugReport,
} from './bugReportPayload';

type FakeEvent = ReturnType<typeof fakeEvent>;

const fakeEvent = (
  id: string,
  ts: number,
  opts: {
    threadRootId?: string;
    replaces?: string;
    status?: string | null;
    body?: string;
    encrypted?: boolean;
    edit?: { event_id: string; content: Record<string, unknown> };
  } = {}
) => {
  const relation = () => {
    if (opts.replaces) return { rel_type: 'm.replace', event_id: opts.replaces };
    if (opts.threadRootId && opts.threadRootId !== id) {
      return { rel_type: 'm.thread', event_id: opts.threadRootId };
    }
    return null;
  };
  const relatesTo = relation() ? { 'm.relates_to': relation() } : {};
  // Encrypted events keep m.relates_to in the clear wire content, outside the ciphertext.
  const originalContent = { body: opts.body ?? id, ...(opts.encrypted ? {} : relatesTo) };
  const wireContent = opts.encrypted
    ? { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'secret', ...relatesTo }
    : originalContent;
  // Like the SDK: once an edit is applied, getContent() is the edit's m.new_content.
  const getContent = () =>
    opts.edit ? (opts.edit.content['m.new_content'] as Record<string, unknown>) : originalContent;
  return {
    getId: () => id,
    getTs: () => ts,
    threadRootId: opts.threadRootId,
    status: opts.status ?? null,
    isDecryptionFailure: () => false,
    getOriginalContent: () => originalContent,
    getWireContent: () => wireContent,
    getContent,
    // Like the SDK: built from getContent(), plus wire keys missing from it for encrypted events.
    getEffectiveEvent: () => ({
      event_id: id,
      type: 'm.room.message',
      origin_server_ts: ts,
      content: opts.encrypted ? { ...relatesTo, ...getContent() } : { ...getContent() },
    }),
    replacingEvent: () => (opts.edit ? { getEffectiveEvent: () => opts.edit } : null),
    isRelation: () => relation() !== null,
    getRelation: relation,
  };
};

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

/** A thread of 250 events: the root and the replies $r0..$r248. */
const longThread = () => {
  const root = fakeEvent('$root', 0, { threadRootId: '$root' });
  const replies = Array.from({ length: 249 }, (_, i) =>
    fakeEvent(`$r${i}`, i + 1, { threadRootId: '$root' })
  );
  const room = fakeRoom({ live: [], thread: { id: '$root', root, events: replies } });
  return { root, replies, room };
};

describe('collectReportEvents', () => {
  it('returns the thread root and every known reply, oldest first, without duplicates', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const b = fakeEvent('$b', 3, { threadRootId: '$root' });
    const room = fakeRoom({
      live: [root, b],
      thread: { id: '$root', root, events: [a, b] },
    });
    const collected = collectReportEvents(room as never, b as never);
    expect(collected.events.map((e) => e.getId())).toEqual(['$root', '$a', '$b']);
    expect(collected.omittedEventCount).toBe(0);
  });

  it('includes a failed local echo that is only known as the selected event', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const failed = fakeEvent('~!room:example.com:m1', 5, {
      threadRootId: '$root',
      status: 'not_sent',
    });
    const room = fakeRoom({ live: [root], thread: { id: '$root', root, events: [] } });
    const ids = collectReportEvents(room as never, failed as never).events.map((e) => e.getId());
    expect(ids).toEqual(['$root', '~!room:example.com:m1']);
  });

  it('leaves m.replace edits out of the thread events', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const edit = fakeEvent('$edit', 3, { threadRootId: '$root', replaces: '$a' });
    const b = fakeEvent('$b', 4, { threadRootId: '$root' });
    const room = fakeRoom({
      live: [root, a, edit, b],
      thread: { id: '$root', root, events: [a, edit, b] },
    });
    const ids = collectReportEvents(room as never, b as never).events.map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$b']);
  });

  it('keeps the selected event even when it is an m.replace edit', () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const a = fakeEvent('$a', 2, { threadRootId: '$root' });
    const edit = fakeEvent('$edit', 3, { threadRootId: '$root', replaces: '$a' });
    const room = fakeRoom({
      live: [root, a, edit],
      thread: { id: '$root', root, events: [a, edit] },
    });
    const ids = collectReportEvents(room as never, edit as never).events.map((e) => e.getId());
    expect(ids).toEqual(['$root', '$a', '$edit']);
  });

  it('takes the 50 events up to the selected main-timeline event', () => {
    const events = Array.from({ length: 80 }, (_, i) => fakeEvent(`$e${i}`, i));
    const room = fakeRoom({ live: events, timelineFor: events });
    const collected = collectReportEvents(room as never, events[59] as never);
    const ids = collected.events.map((e) => e.getId());
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('$e10');
    expect(ids[49]).toBe('$e59');
    expect(collected.omittedEventCount).toBe(0);
  });

  it('does not count or include m.replace edits in the main-timeline window', () => {
    const events = Array.from({ length: 80 }, (_, i) => [
      fakeEvent(`$e${i}`, i * 2),
      fakeEvent(`$edit${i}`, i * 2 + 1, { replaces: `$e${i}` }),
    ]).flat();
    const room = fakeRoom({ live: events, timelineFor: events });
    const selected = events.find((e) => e.getId() === '$e59');
    const ids = collectReportEvents(room as never, selected as never).events.map((e) => e.getId());
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('$e10');
    expect(ids[49]).toBe('$e59');
    expect(ids.some((id) => id?.startsWith('$edit'))).toBe(false);
  });

  it('keeps the root and the newest 200 replies of a longer thread', () => {
    const { replies, room } = longThread();
    const { events, omittedEventCount } = collectReportEvents(room as never, replies[248] as never);
    const ids = events.map((e) => e.getId());
    // The newest 200 replies are $r49..$r248.
    expect(ids).toHaveLength(201);
    expect(ids[0]).toBe('$root');
    expect(ids[1]).toBe('$r49');
    expect(ids[200]).toBe('$r248');
    expect(omittedEventCount).toBe(49);
  });

  it('ends the thread window at a selected reply older than the newest 200', () => {
    const { replies, room } = longThread();
    const { events, omittedEventCount } = collectReportEvents(room as never, replies[20] as never);
    const ids = events.map((e) => e.getId());
    expect(ids).toHaveLength(22);
    expect(ids[0]).toBe('$root');
    expect(ids[1]).toBe('$r0');
    expect(ids[21]).toBe('$r20');
    expect(omittedEventCount).toBe(228);
  });

  it('keeps the newest 200 replies when the thread root itself is reported', () => {
    const { root, room } = longThread();
    const { events, omittedEventCount } = collectReportEvents(room as never, root as never);
    const ids = events.map((e) => e.getId());
    expect(ids).toHaveLength(201);
    expect(ids[0]).toBe('$root');
    expect(ids[1]).toBe('$r49');
    expect(omittedEventCount).toBe(49);
  });
});

// jsdom's Blob has no text().
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe('serializeBugReport', () => {
  it('writes compact JSON', async () => {
    const report = { type: 'io.mindroom.bug_report', events: [{ eventId: '$a' }] };
    const text = await readBlob(serializeBugReport(report as never));
    expect(text).toBe(JSON.stringify(report));
    expect(text).not.toContain('\n');
  });
});

describe('buildBugReport', () => {
  const mx = {
    getSafeUserId: () => '@alice:example.com',
    getDeviceId: () => 'DEVICE',
    getHomeserverUrl: () => 'https://hs.example.com',
    getSyncState: () => 'SYNCING',
  };

  it('captures identifiers, events with latest edits, client state, and diagnostics', async () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const reply = fakeEvent('$reply', 2, {
      threadRootId: '$root',
      edit: { event_id: '$edit', content: { 'm.new_content': { body: 'final' } } },
    });
    const room = fakeRoom({ live: [root, reply], thread: { id: '$root', root, events: [reply] } });
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
    expect(report.omittedEventCount).toBe(0);
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

  it('keeps the original content and relation of an edited event next to its latest edit', async () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const edit = {
      event_id: '$edit',
      content: {
        body: '* final',
        'm.new_content': { body: 'final' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
      },
    };
    const reply = fakeEvent('$reply', 2, { threadRootId: '$root', body: 'draft', edit });
    const room = fakeRoom({ live: [root, reply], thread: { id: '$root', root, events: [reply] } });
    const report = await buildBugReport(mx as never, room as never, reply as never);
    expect(report.events[1].event).toMatchObject({ event_id: '$reply', origin_server_ts: 2 });
    expect(report.events[1].event.content).toEqual({
      body: 'draft',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    });
    expect(report.events[1].latestEdit).toEqual(edit);
  });

  it('keeps the wire relation of an encrypted event without its ciphertext', async () => {
    const root = fakeEvent('$root', 1, { threadRootId: '$root' });
    const reply = fakeEvent('$reply', 2, {
      threadRootId: '$root',
      body: 'secret',
      encrypted: true,
    });
    const room = fakeRoom({ live: [root, reply], thread: { id: '$root', root, events: [reply] } });
    const report = await buildBugReport(mx as never, room as never, reply as never);
    expect(report.events[1].event.content).toEqual({
      body: 'secret',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    });
  });
});
