import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IEvent, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { getCacheProbeSnapshot, resetCacheProbe } from '../../threads/cacheProbe';
import type { HydratedThreadCachePage } from '../../threads/types';

const THREAD_ID = '$thread';
const AGENT = '@agent:example';

const makeFakeEvent = (raw: Partial<IEvent>): MatrixEvent =>
  ({
    getId: () => raw.event_id,
    getType: () => raw.type,
    getTs: () => raw.origin_server_ts ?? 0,
    isRedaction: () => false,
    isRedacted: () => !!raw.unsigned?.redacted_because,
    isSending: () => false,
    getAssociatedId: () => undefined,
    getRelation: () =>
      (raw.content as Record<string, unknown> | undefined)?.['m.relates_to'] ?? null,
    getUnsigned: () => raw.unsigned ?? {},
    setUnsigned: (unsigned: IEvent['unsigned']) => {
      raw.unsigned = unsigned;
    },
    makeRedacted: () => undefined,
    makeReplaced: () => undefined,
    replacingEvent: () => null,
    getSender: () => raw.sender,
    getContent: () => raw.content ?? {},
    getWireContent: () => raw.content ?? {},
    event: raw,
  } as unknown as MatrixEvent);

const reply = (id: string, ts: number, unsigned?: IEvent['unsigned']): Partial<IEvent> => ({
  event_id: id,
  type: 'm.room.message',
  sender: AGENT,
  origin_server_ts: ts,
  content: { body: id, 'm.relates_to': { rel_type: 'm.thread', event_id: THREAD_ID } } as never,
  ...(unsigned ? { unsigned } : {}),
});

const edit = (id: string, targetId: string, ts: number, sender = AGENT): Partial<IEvent> => ({
  event_id: id,
  type: 'm.room.message',
  sender,
  origin_server_ts: ts,
  content: {
    body: `* ${id}`,
    'm.new_content': { body: id },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  } as never,
});

/** How the cache stores a reply: its newest same-sender edit folded in, no edit records. */
const foldedReply = (id: string, ts: number, newestEdit: Partial<IEvent>): Partial<IEvent> =>
  reply(id, ts, { 'm.relations': { 'm.replace': newestEdit } } as never);

const redacted = (raw: Partial<IEvent>): Partial<IEvent> =>
  ({
    ...raw,
    content: {},
    unsigned: { redacted_because: { event_id: '$redaction' } },
  } as Partial<IEvent>);

const reconcile = async (
  cachedEvents: Partial<IEvent>[],
  serverEvents: Partial<IEvent>[],
  cachedRoot?: Partial<IEvent>
) => {
  const room = {
    roomId: '!room:example',
    findEventById: () => null,
    getThread: () => undefined,
  } as unknown as Room;
  const mx = {
    getRoom: () => room,
    getEventMapper: () => makeFakeEvent,
    // `/relations` pages newest first.
    fetchRelations: vi.fn(async () => ({ chunk: serverEvents.slice().reverse() })),
  } as unknown as MatrixClient;
  const onRepaired = vi.fn();
  const result = await scheduleReconcile({
    mx,
    sessionId: 'session',
    scheduler: createBackfillScheduler({ mx }),
    roomId: room.roomId,
    threadId: THREAD_ID,
    cachedPage: {
      events: cachedEvents,
      rootEvent: cachedRoot,
      hasMoreBefore: false,
      tailLoaded: true,
    } as HydratedThreadCachePage,
    room,
    onRepaired,
    persistRepair: () => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }),
  });
  return { result, onRepaired };
};

describe('reconciler divergence with edits folded into the cache', () => {
  beforeEach(() => {
    resetCacheProbe();
  });
  afterEach(() => {
    resetCacheProbe();
  });

  const v1 = edit('$edit-1', '$reply', 110);
  const v2 = edit('$edit-2', '$reply', 120);

  it('treats edits the cached target already carries, or that it supersedes, as known', async () => {
    const { result, onRepaired } = await reconcile(
      [foldedReply('$reply', 100, v2)],
      [reply('$reply', 100), v1, v2]
    );

    expect(result.repaired).toBe(false);
    expect(onRepaired).not.toHaveBeenCalled();
    expect(getCacheProbeSnapshot().reconcilesNoDivergence).toBe(1);
  });

  it('treats the newest edit Tuwunel bundles onto the reply as known', async () => {
    const { result } = await reconcile(
      [foldedReply('$reply', 100, v2)],
      [foldedReply('$reply', 100, v2), v2]
    );

    expect(result.repaired).toBe(false);
  });

  it('treats an edit folded into the cached root as known', async () => {
    const rootEdit = edit('$root-edit', THREAD_ID, 20);
    const root = {
      event_id: THREAD_ID,
      type: 'm.room.message',
      sender: AGENT,
      origin_server_ts: 10,
      content: { body: 'root' },
      unsigned: { 'm.relations': { 'm.replace': rootEdit } },
    } as Partial<IEvent>;

    const { result } = await reconcile(
      [foldedReply('$reply', 100, v2)],
      [reply('$reply', 100), v2, rootEdit],
      root
    );

    expect(result.repaired).toBe(false);
  });

  it('repairs an edit newer than the one folded into the cache', async () => {
    const { result } = await reconcile(
      [foldedReply('$reply', 100, v1)],
      [reply('$reply', 100), v1, v2]
    );

    expect(result.repaired).toBe(true);
  });

  it('treats edits of a redacted cached target as known', async () => {
    const redactedReply = redacted(reply('$reply', 100));

    const { result } = await reconcile([redactedReply], [redactedReply, v1, v2]);

    expect(result.repaired).toBe(false);
  });

  it('repairs an uncached edit from another sender, which the cache keeps as its own record', async () => {
    const { result } = await reconcile(
      [foldedReply('$reply', 100, v2)],
      [reply('$reply', 100), v2, edit('$edit-other', '$reply', 115, '@mallory:example')]
    );

    expect(result.repaired).toBe(true);
  });

  it('repairs an uncached edit from another sender of a redacted target', async () => {
    const redactedReply = redacted(reply('$reply', 100));

    const { result } = await reconcile(
      [redactedReply],
      [redactedReply, edit('$edit-other', '$reply', 115, '@mallory:example')]
    );

    expect(result.repaired).toBe(true);
  });

  it('repairs a missed reply to a redacted root', async () => {
    const root = redacted({
      event_id: THREAD_ID,
      type: 'm.room.message',
      sender: AGENT,
      origin_server_ts: 10,
    });

    const { result } = await reconcile(
      [reply('$reply', 100)],
      [reply('$reply', 100), reply('$missed', 200)],
      root
    );

    expect(result.repaired).toBe(true);
  });
});
