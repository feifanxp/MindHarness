import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { createClient, MatrixEvent, MatrixEventEvent, Room, ThreadEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { hydrateCachedEvents, serializeEventsForCache } from '../threads/eventCacheEditUtils';
import {
  ThreadApprovalProvider,
  ThreadApprovals,
  useThreadApprovals,
} from './ThreadApprovalProvider';

const mocks = vi.hoisted(() => ({ backfill: vi.fn(), abort: vi.fn(), persist: vi.fn() }));
let mx: ReturnType<typeof createClient>;
let room: Room;
let ignored: string[];
const IgnoredContext = React.createContext<string[] | undefined>(undefined);
const scheduler = { abort: mocks.abort };
const persist = { persistThreadEventCache: mocks.persist };
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => React.useContext(IgnoredContext) ?? ignored,
}));
vi.mock('../engine', () => ({
  enqueueThreadApprovalBackfill: mocks.backfill,
  useMindroomSyncEngine: () => ({ scheduler, persist }),
}));
vi.mock('../threads/roomLiveEventArrive', () => ({ useLiveEventArrive: () => undefined }));
let current: ThreadApprovals;
let renderer: ReactTestRenderer;
function Probe() {
  current = useThreadApprovals()!;
  return null;
}
const content = {
  approval_id: 'one',
  tool_name: 'invite',
  agent_name: 'assistant',
  arguments: { user: 'Jamie' },
  status: 'pending',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2999-09-12T12:00:00Z',
  thread_id: '$thread',
};
const event = (id = '$approval', value = content) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@mindroom_router:example.org',
    origin_server_ts: 1,
    type: 'io.mindroom.tool_approval',
    content: structuredClone(value),
  });
const mount = async () => {
  await act(async () => {
    renderer = create(
      <ThreadApprovalProvider room={room} threadId="$thread">
        <Probe />
      </ThreadApprovalProvider>
    );
  });
};

beforeEach(() => {
  mocks.backfill
    .mockReset()
    .mockImplementation(async (_mx, _scheduler, _room, _thread, origins?: MatrixEvent[]) => ({
      events: [],
      repairedEventIds: (origins ?? []).flatMap((origin) => origin.getId() ?? []),
    }));
  mocks.abort.mockReset();
  mocks.persist.mockReset();
  ignored = [];
  mx = createClient({ baseUrl: 'https://matrix.example.org', userId: '@alice:example.org' });
  room = new Room('!room:example.org', mx, '@alice:example.org');
  mx.store.storeRoom(room);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('thread approval provider lifecycle', () => {
  it('repairs a late-decrypted offscreen origin once through its direct SDK event subscription', async () => {
    const encrypted = new MatrixEvent({
      ...event().event,
      type: 'm.room.encrypted',
      content: { ciphertext: 'late keys' },
    });
    await encrypted.attemptDecryption({
      decryptEvent: async () => {
        throw new Error('Missing room key');
      },
    } as CryptoBackend);
    expect(encrypted.isDecryptionFailure()).toBe(true);
    const unreadableMessage = new MatrixEvent({
      ...event('$unreadable').event,
      type: 'm.room.encrypted',
      content: { ciphertext: 'another missing key' },
    });
    await unreadableMessage.attemptDecryption({
      decryptEvent: async () => {
        throw new Error('Missing room key');
      },
    } as CryptoBackend);
    mocks.backfill.mockResolvedValueOnce({
      events: [encrypted, unreadableMessage],
      repairedEventIds: [],
    });
    const edit = new MatrixEvent({
      ...event('$edit').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    mocks.backfill.mockResolvedValueOnce({ events: [edit], repairedEventIds: ['$approval'] });
    await mount();
    expect(current.records).toEqual([]);
    expect(current.loading).toBe(false);
    expect(current.error).toContain('decrypt');
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
    await act(async () => {
      await encrypted.attemptDecryption({
        decryptEvent: async () => ({ clearEvent: { type: 'io.mindroom.tool_approval', content } }),
      } as CryptoBackend);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    expect(mocks.backfill.mock.calls[1][4]).toEqual([encrypted]);
    expect(current.records[0].approval.status).toBe('approved');
    // A successful targeted repair cannot conceal another unreadable event.
    expect(current.error).toContain('decrypt');
    await act(async () => {
      await unreadableMessage.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: { type: 'm.room.message', content: { body: 'Hello' } },
        }),
      } as CryptoBackend);
    });
    expect(current.error).toBeUndefined();
    expect(unreadableMessage.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    await act(async () => {
      encrypted.emit(MatrixEventEvent.Decrypted, encrypted);
    });
    expect(mocks.backfill).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
    expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });
  it('retains newer bundled replacements when an older fetch completes and removes ignored senders', async () => {
    let finish!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await mount();
    await act(async () => {
      current.ingestTimeline([event()]);
    });
    const updated = event();
    updated.makeReplaced(
      new MatrixEvent({
        ...event('$edit').event,
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': { ...content, status: 'approved' },
        },
      })
    );
    await act(async () => {
      current.ingestTimeline([updated]);
      finish({ events: [event()], repairedEventIds: ['$approval'] });
    });
    expect(current.records[0].approval.status).toBe('approved');
    expect(updated.getContent().status).toBe('approved');
    ignored = ['@mindroom_router:example.org'];
    await act(async () => {
      renderer.update(
        <ThreadApprovalProvider room={room} threadId="$thread">
          <Probe />
        </ThreadApprovalProvider>
      );
    });
    expect(current.records).toEqual([]);
  });
  it('keeps approval cards only from MindRoom accounts on the viewer homeserver', async () => {
    await mount();
    const from = (id: string, sender: string) => new MatrixEvent({ ...event(id).event, sender });
    await act(async () => {
      current.ingestTimeline([
        event(),
        from('$member', '@mallory:example.org'),
        from('$foreign', '@mindroom_router:other.example'),
      ]);
    });
    expect(current.records.map((record) => record.eventId)).toEqual(['$approval']);
  });
  it('settles local expiry at its deadline without a Matrix edit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    mocks.backfill.mockResolvedValue({
      events: [event('$approval', { ...content, expires_at: '2026-09-12T12:00:02Z' })],
      repairedEventIds: ['$approval'],
    });
    await mount();
    expect(current.records[0].approval.status).toBe('pending');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(current.records[0].approval.status).toBe('expired');
  });
});

it('keeps a submitted request in review past local expiry until Matrix acknowledges it', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  vi.spyOn(mx, 'sendEvent').mockResolvedValue({ event_id: '$response' });
  const origin = event('$approval', { ...content, expires_at: '2026-09-12T12:00:02Z' });
  mocks.backfill.mockResolvedValue({ events: [origin], repairedEventIds: ['$approval'] });
  await mount();
  await act(async () => {
    await current.submit(current.records[0], { status: 'approved' });
  });
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(current.actions.get('$approval')?.status).toBe('submitted');
  expect(current.pendingEventIds.has('$approval')).toBe(true);
  await act(async () => {
    current.ingestTimeline([
      new MatrixEvent({
        ...event('$decision').event,
        origin_server_ts: 2,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
          'm.new_content': { ...origin.getContent(), status: 'approved' },
        },
      }),
    ]);
  });
  expect(current.records[0].approval.status).toBe('approved');
  expect(current.actions.size).toBe(0);
  expect(current.pendingEventIds.size).toBe(0);
});

it('keeps failed discovery visible after a successful targeted repair until full retry succeeds', async () => {
  const encrypted = new MatrixEvent({
    ...event().event,
    type: 'm.room.encrypted',
    content: { ciphertext: 'late keys' },
  });
  const discoveryError = 'Some approval history could not be loaded.';
  mocks.backfill.mockResolvedValueOnce({
    events: [encrypted],
    repairedEventIds: [],
    error: discoveryError,
  });
  mocks.backfill.mockResolvedValueOnce({ events: [], repairedEventIds: ['$approval'] });
  await mount();
  expect(current.error).toBe(discoveryError);
  await act(async () => {
    await encrypted.attemptDecryption({
      decryptEvent: async () => ({ clearEvent: { type: 'io.mindroom.tool_approval', content } }),
    } as CryptoBackend);
  });
  expect(mocks.backfill).toHaveBeenCalledTimes(2);
  expect(mocks.backfill.mock.calls[1][4]).toEqual([encrypted]);
  expect(current.error).toBe(discoveryError);
  mocks.backfill.mockResolvedValueOnce({ events: [encrypted], repairedEventIds: ['$approval'] });
  await act(async () => current.refresh());
  expect(mocks.backfill.mock.calls[2][4]).toBeUndefined();
  expect(current.error).toBeUndefined();
});

it.each([
  ['origin', false],
  ['edit', false],
  ['origin', true],
  ['edit', true],
] as const)(
  'keeps a refreshed %s redaction (encrypted=%s) when stale SDK objects are ingested again',
  async (target, encrypted) => {
    let origin = event();
    let edit = new MatrixEvent({
      ...event('$edit').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    if (encrypted) {
      const wrap = async (plain: MatrixEvent) => {
        const wrapped = new MatrixEvent({
          ...plain.event,
          type: 'm.room.encrypted',
          content: { ciphertext: 'encrypted history', 'm.relates_to': plain.getRelation() },
        });
        await wrapped.attemptDecryption({
          decryptEvent: async () => ({
            clearEvent: { type: plain.getType(), content: plain.getOriginalContent() },
          }),
        } as CryptoBackend);
        return wrapped;
      };
      origin = await wrap(origin);
      edit = await wrap(edit);
    }
    origin.makeReplaced(edit);
    mocks.backfill.mockResolvedValueOnce({
      events: [origin, edit],
      repairedEventIds: ['$approval'],
    });
    await mount();
    expect(current.records[0].approval.status).toBe('approved');
    const removed = target === 'origin' ? origin : edit;
    const tombstone = new MatrixEvent({
      ...removed.event,
      content: {},
      unsigned: {
        redacted_because: {
          event_id: '$redaction',
          room_id: room.roomId,
          type: 'm.room.redaction',
          sender: '@mindroom_router:example.org',
          content: {},
          redacts: removed.getId(),
        },
      },
    });
    mocks.backfill.mockResolvedValueOnce({ events: [tombstone], repairedEventIds: ['$approval'] });
    await act(async () => current.refresh());
    await act(async () => current.ingestTimeline([origin, edit]));
    expect(current.error).toBeUndefined();
    expect(current.records.map((record) => record.approval.status)).toEqual(
      target === 'origin' ? [] : ['pending']
    );
  }
);

it('preserves concurrent arrivals while a refresh learns an old origin was redacted', async () => {
  const origin = event();
  mocks.backfill.mockResolvedValueOnce({ events: [origin], repairedEventIds: ['$approval'] });
  await mount();
  let finish!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
  mocks.backfill.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => current.refresh());
  expect(mocks.backfill.mock.calls[1][5]).toEqual([origin]);
  await act(async () => current.ingestTimeline([event('$new')]));
  await act(async () =>
    finish({
      events: [
        new MatrixEvent({
          ...origin.event,
          content: {},
          unsigned: {
            redacted_because: {
              event_id: '$redaction',
              room_id: room.roomId,
              type: 'm.room.redaction',
              sender: '@mindroom_router:example.org',
              content: {},
              redacts: '$approval',
            },
          },
        }),
      ],
      repairedEventIds: [],
    })
  );
  expect(current.records.map((record) => record.eventId)).toEqual(['$new']);
});

it('includes cached approvals in the first recovery snapshot before passive ingestion runs', async () => {
  const cached = event();
  room.getLiveTimeline().getEvents().push(cached);
  await mount();
  expect(mocks.backfill.mock.calls[0][5]).toEqual([cached]);
});

it('does not retain ciphertext from another thread and releases decoded non-approval events', async () => {
  const unrelated = new MatrixEvent({
    ...event('$unrelated').event,
    type: 'm.room.encrypted',
    content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$other' } },
  });
  const relevant = new MatrixEvent({
    ...event('$relevant').event,
    type: 'm.room.encrypted',
    content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' } },
  });
  await mount();
  await act(async () => {
    current.ingestTimeline([unrelated, relevant]);
  });
  expect(unrelated.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  expect(relevant.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);
  await act(async () => {
    await relevant.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: { type: 'm.room.message', content: { body: 'Hello' } },
      }),
    } as CryptoBackend);
  });
  expect(relevant.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
});

it('keeps send completion bound to committed records during a suspended transition', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (value: { event_id: string }) => void;
  vi.spyOn(mx, 'sendEvent').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mocks.backfill.mockResolvedValue({ events: [event()], repairedEventIds: ['$approval'] });
  const suspended = new Promise<void>(() => {});
  const hiddenUsers = ['@mindroom_router:example.org'];
  const visibleUsers: string[] = [];
  let attemptedHiddenRender = false;
  function Gate({ block }: { block: boolean }) {
    if (block) {
      attemptedHiddenRender = true;
      throw suspended;
    }
    return null;
  }
  const tree = (block: boolean) => (
    <React.Suspense fallback={null}>
      <IgnoredContext.Provider value={block ? hiddenUsers : visibleUsers}>
        <ThreadApprovalProvider room={room} threadId="$thread">
          <Probe />
          <Gate block={block} />
        </ThreadApprovalProvider>
      </IgnoredContext.Provider>
    </React.Suspense>
  );
  await act(async () => {
    renderer = create(tree(false), { unstable_isConcurrent: true } as Parameters<typeof create>[1]);
  });
  let sending!: Promise<void>;
  await act(async () => {
    sending = current.submit(current.records[0], { status: 'approved' });
  });
  await act(async () => {
    React.startTransition(() => renderer.update(tree(true)));
  });
  expect(attemptedHiddenRender).toBe(true);
  await act(async () => {
    finish({ event_id: '$response' });
    await sending;
  });
  await act(async () => renderer.update(tree(false)));
  expect(current.records).toHaveLength(1);
  expect(current.actions.get('$approval')?.status).toBe('submitted');
});

it.each(['during', 'after'] as const)(
  'repairs and persists the exact cached original ingested %s discovery',
  async (timing) => {
    let finish!: (value: { events: MatrixEvent[]; repairedEventIds: string[] }) => void;
    mocks.backfill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const cached = event();
    const edit = new MatrixEvent({
      ...event('$edit').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    await mount();
    if (timing === 'during') await act(async () => current.ingestTimeline([cached]));
    await act(async () => finish({ events: [event(), edit], repairedEventIds: ['$approval'] }));
    if (timing === 'after') await act(async () => current.ingestTimeline([cached]));
    expect(cached.getContent().status).toBe('approved');
    expect(current.records[0].approval.status).toBe('approved');
    const saved = mocks.persist.mock.lastCall![2] as MatrixEvent[];
    expect(saved).toContain(cached);
    const reopened = serializeEventsForCache(room, saved).map((raw) => new MatrixEvent(raw));
    hydrateCachedEvents({ room, events: reopened });
    expect(reopened.find((item) => item.getId() === '$approval')!.getContent().status).toBe(
      'approved'
    );
  }
);

it('applies a recovered tombstone to the detached cached original and persists it', async () => {
  const cached = event();
  await mount();
  await act(async () => current.ingestTimeline([cached]));
  const removed = event();
  removed.makeRedacted(
    new MatrixEvent({
      event_id: '$redaction',
      room_id: room.roomId,
      sender: '@mindroom_router:example.org',
      type: 'm.room.redaction',
      content: {},
      redacts: '$approval',
    }),
    room
  );
  mocks.backfill.mockResolvedValueOnce({ events: [removed], repairedEventIds: [] });
  await act(async () => current.refresh());
  expect(cached.isRedacted()).toBe(true);
  expect(current.records).toEqual([]);
  const saved = mocks.persist.mock.lastCall![2] as MatrixEvent[];
  expect(saved.find((item) => item.getId() === '$approval')!.isRedacted()).toBe(true);
});

it('hydrates a late-decrypted edit into the same cached original', async () => {
  const cached = event();
  const encryptedEdit = new MatrixEvent({
    ...event('$edit').event,
    origin_server_ts: 2,
    type: 'm.room.encrypted',
    content: {
      ciphertext: 'late keys',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
    },
  });
  await encryptedEdit.attemptDecryption({
    decryptEvent: async () => {
      throw new Error('Missing key');
    },
  } as CryptoBackend);
  mocks.backfill.mockResolvedValueOnce({
    events: [event(), encryptedEdit],
    repairedEventIds: ['$approval'],
  });
  await mount();
  await act(async () => current.ingestTimeline([cached]));
  expect(cached.getContent().status).toBe('pending');
  await act(async () => {
    await encryptedEdit.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: {
          type: 'io.mindroom.tool_approval',
          content: {
            'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
            'm.new_content': { ...content, status: 'approved' },
          },
        },
      }),
    } as CryptoBackend);
  });
  expect(cached.getContent().status).toBe('approved');
  expect(current.records[0].approval.status).toBe('approved');
  expect(current.error).toBeUndefined();
  expect(mocks.persist.mock.lastCall![2]).toContain(cached);
});

it('keeps foreign approval edits and room redactions out of this thread cache', async () => {
  const own = event();
  const foreign = event('$foreign', { ...content, thread_id: '$another' });
  const foreignEdit = new MatrixEvent({
    ...event('$foreign-edit').event,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$foreign' },
      'm.new_content': { ...content, thread_id: '$another', status: 'approved' },
    },
  });
  const foreignRedaction = new MatrixEvent({
    event_id: '$foreign-redaction',
    room_id: room.roomId,
    type: 'm.room.redaction',
    sender: '@mindroom_router:example.org',
    content: {},
    redacts: '$foreign',
  });
  room.getLiveTimeline().getEvents().push(foreign);
  await mount();
  await act(async () => current.ingestTimeline([own, foreignEdit, foreignRedaction]));
  const saved = mocks.persist.mock.lastCall![2] as MatrixEvent[];
  expect(saved.map((item) => item.getId())).toEqual(['$approval']);
  expect(foreign.getContent().status).toBe('pending');
});

it('redacts an undecrypted cached original when its same-ID tombstone is recovered', async () => {
  const cached = new MatrixEvent({
    ...event().event,
    type: 'm.room.encrypted',
    content: {
      ciphertext: 'missing key',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    },
  });
  await mount();
  await act(async () => current.ingestTimeline([cached]));
  const removed = new MatrixEvent({
    ...cached.event,
    content: {},
    unsigned: {
      redacted_because: {
        event_id: '$redaction',
        room_id: room.roomId,
        sender: '@mindroom_router:example.org',
        type: 'm.room.redaction',
        content: {},
        redacts: '$approval',
      },
    },
  });
  mocks.backfill.mockResolvedValueOnce({ events: [removed], repairedEventIds: [] });
  await act(async () => current.refresh());
  expect(cached.isRedacted()).toBe(true);
  expect(current.records).toEqual([]);
});

it('repairs a plaintext origin learned after discovery omitted it', async () => {
  await mount();
  const cached = event();
  const edit = new MatrixEvent({
    ...event('$edit').event,
    origin_server_ts: 2,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
      'm.new_content': { ...content, status: 'approved' },
    },
  });
  mocks.backfill.mockResolvedValueOnce({ events: [edit], repairedEventIds: ['$approval'] });
  await act(async () => current.ingestTimeline([cached]));
  expect(mocks.backfill).toHaveBeenCalledTimes(2);
  expect(mocks.backfill.mock.calls[1][4]).toEqual([cached]);
  expect(cached.getContent().status).toBe('approved');
});

it.each(['redaction', 'tombstone'] as const)(
  'keeps an early %s authoritative when a stale cached approval arrives later',
  async (kind) => {
    const cached = event();
    const redaction = new MatrixEvent({
      event_id: '$redaction',
      room_id: room.roomId,
      sender: '@mindroom_router:example.org',
      type: 'm.room.redaction',
      content: {},
      redacts: '$approval',
    });
    const evidence =
      kind === 'redaction'
        ? redaction
        : new MatrixEvent({
            ...event().event,
            content: {},
            unsigned: { redacted_because: redaction.event },
          });
    room.getLiveTimeline().getEvents().push(evidence);
    await mount();
    expect(mocks.persist).not.toHaveBeenCalled();
    await act(async () => current.ingestTimeline([cached]));
    expect(current.pendingEventIds.size).toBe(0);
    expect(current.records).toEqual([]);
    expect(cached.isRedacted()).toBe(true);
    const saved = mocks.persist.mock.lastCall![2] as MatrixEvent[];
    expect(saved.find((item) => item.getId() === '$approval')!.isRedacted()).toBe(true);
  }
);

it('publishes an approved replacement attached to a later SDK original', async () => {
  const cached = event();
  await mount();
  await act(async () => current.ingestTimeline([cached]));
  const newer = event();
  const edit = new MatrixEvent({
    ...event('$sdk-edit').event,
    origin_server_ts: 2,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
      'm.new_content': { ...content, status: 'approved' },
    },
  });
  newer.makeReplaced(edit);
  await act(async () => mx.emit(MatrixEventEvent.Replaced, newer));
  expect(current.records[0].approval.status).toBe('approved');
  expect(cached.getContent().status).toBe('approved');
  const saved = serializeEventsForCache(room, mocks.persist.mock.lastCall![2]);
  const reopened = saved.map((raw) => new MatrixEvent(raw));
  hydrateCachedEvents({ room, events: reopened });
  expect(reopened.find((item) => item.getId() === '$approval')!.getContent().status).toBe(
    'approved'
  );
});

it.each(['bundled', 'attached'] as const)(
  'keeps a %s encrypted edit out of approval hydration until its keys arrive',
  async (kind) => {
    const cached = event();
    const approved = new MatrixEvent({
      ...event('$approved').event,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...content, status: 'approved' },
      },
    });
    cached.makeReplaced(approved);
    const ciphertext = {
      ...event('$encrypted-edit').event,
      origin_server_ts: 3,
      type: 'm.room.encrypted',
      content: {
        ciphertext: 'pending key',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
      },
    };
    const decrypt = vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue(undefined);
    await mount();
    await act(async () => current.ingestTimeline([cached]));
    if (kind === 'bundled') cached.setUnsigned({ 'm.relations': { 'm.replace': ciphertext } });
    else cached.makeReplaced(new MatrixEvent(ciphertext));
    await act(async () => current.ingestTimeline([cached]));
    expect(cached.getContent().status).toBe('approved');
    expect(current.records[0].approval.status).toBe('approved');
    expect(current.error).toContain('could not be decrypted');
    const saved = serializeEventsForCache(room, mocks.persist.mock.lastCall![2]);
    expect(JSON.stringify(saved)).not.toContain('pending key');
    const retained = decrypt.mock.calls.find(([item]) => item.getId() === '$encrypted-edit')?.[0];
    expect(retained).toBeDefined();
    await act(async () => {
      await retained!.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: {
            ...approved.event,
            event_id: '$encrypted-edit',
            content: {
              ...approved.event.content,
              'm.new_content': { ...content, status: 'denied' },
            },
          },
        }),
      } as CryptoBackend);
    });
    expect(cached.getContent().status).toBe('denied');
    expect(current.error).toBeUndefined();
  }
);

it('leaves ordinary-message encrypted replacement bundles with their timeline owner', async () => {
  const ordinary = new MatrixEvent({
    ...event('$ordinary').event,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'original' },
    unsigned: {
      'm.relations': {
        'm.replace': {
          ...event('$ordinary-edit').event,
          type: 'm.room.encrypted',
          origin_server_ts: 2,
          content: {
            ciphertext: 'ordinary edit',
            'm.relates_to': { rel_type: 'm.replace', event_id: '$ordinary' },
          },
        },
      },
    },
  });
  const frozen = structuredClone(ordinary.event);
  await mount();
  await act(async () => current.ingestTimeline([event(), ordinary]));
  expect(ordinary.event).toEqual(frozen);
  expect(
    (mocks.persist.mock.lastCall![2] as MatrixEvent[]).some((item) => item.getId() === '$ordinary')
  ).toBe(false);
});

it('applies a standalone redaction to a cached ciphertext approval before keys arrive', async () => {
  const cached = new MatrixEvent({
    ...event().event,
    type: 'm.room.encrypted',
    content: {
      ciphertext: 'pending key',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    },
  });
  const redaction = new MatrixEvent({
    event_id: '$redaction',
    room_id: room.roomId,
    sender: '@mindroom_router:example.org',
    type: 'm.room.redaction',
    content: {},
    redacts: '$approval',
  });
  vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue(undefined);
  await mount();
  await act(async () => current.ingestTimeline([cached]));
  expect(current.error).toContain('could not be decrypted');
  await act(async () => current.ingestTimeline([cached, redaction]));
  expect(cached.isRedacted()).toBe(true);
  expect(current.error).toBeUndefined();
  const saved = mocks.persist.mock.lastCall![2] as MatrixEvent[];
  expect(saved.find((item) => item.getId() === '$approval')!.isRedacted()).toBe(true);
});

it('redacts a ciphertext timeline copy when retained approval evidence is already readable', async () => {
  const readable = event();
  mocks.backfill.mockResolvedValueOnce({ events: [readable], repairedEventIds: ['$approval'] });
  await mount();
  const cached = new MatrixEvent({
    ...event().event,
    type: 'm.room.encrypted',
    content: {
      ciphertext: 'pending key',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
    },
  });
  const redaction = new MatrixEvent({
    event_id: '$redaction',
    room_id: room.roomId,
    sender: '@mindroom_router:example.org',
    type: 'm.room.redaction',
    content: {},
    redacts: '$approval',
  });
  await act(async () => current.ingestTimeline([cached, redaction]));
  expect(readable.isRedacted()).toBe(true);
  expect(cached.isRedacted()).toBe(true);
  expect(current.records).toEqual([]);
  expect(current.error).toBeUndefined();
});

describe('thread approval provider rescans', () => {
  const nextTask = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  const recordIds = () => current.records.map((record) => record.eventId).sort();

  it('rescans the room and thread once per burst of SDK thread events', async () => {
    await mount();
    // The SDK emits one per event it adds to a thread, e.g. a reconcile's backfill.
    const thread = { events: [event()] };
    const rescans = vi.spyOn(room, 'getThread').mockReturnValue(thread as never);
    const burst = (signal: ThreadEvent) =>
      act(async () => {
        for (let i = 0; i < 100; i += 1) room.emit(signal, thread as never);
        await nextTask();
      });

    await burst(ThreadEvent.Update);
    expect(rescans).toHaveBeenCalledTimes(1);
    expect(recordIds()).toEqual(['$approval']);

    thread.events.push(event('$second', { ...content, approval_id: 'two' }));
    await burst(ThreadEvent.NewReply);
    expect(rescans).toHaveBeenCalledTimes(2);
    expect(recordIds()).toEqual(['$approval', '$second']);
  });

  it('drops a queued rescan when the provider unmounts', async () => {
    await mount();
    const rescans = vi.spyOn(room, 'getThread');
    room.emit(ThreadEvent.Update, {} as never);
    act(() => renderer.unmount());
    await nextTask();
    expect(rescans).not.toHaveBeenCalled();
  });
});
