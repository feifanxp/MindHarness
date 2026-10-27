import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from './backfillScheduler';
import { enqueueThreadApprovalBackfill } from './threadApprovalBackfill';
import { collectThreadApprovals } from '../messages/threadApprovalModel';

const roomId = '!room:example.org';
const threadId = '$thread';
const original = {
  room_id: roomId,
  event_id: '$approval',
  sender: '@router:example.org',
  type: 'io.mindroom.tool_approval',
  origin_server_ts: 1,
  content: {
    approval_id: 'one',
    tool_name: 'invite',
    agent_name: 'assistant',
    arguments: { user: 'Jamie' },
    status: 'pending',
    requested_at: '2026-09-12T12:00:00Z',
    expires_at: '2999-09-12T12:00:00Z',
    thread_id: threadId,
  },
};
const setup = () => {
  const mx = createClient({ baseUrl: 'https://matrix.example.org' });
  const room = new Room(roomId, mx, '@alice:example.org');
  mx.store.storeRoom(room);
  return { mx, room, scheduler: createBackfillScheduler({ mx }) };
};

const redacted = (value: typeof original) => ({
  ...value,
  content: {},
  unsigned: {
    redacted_because: {
      event_id: `$redact-${value.event_id}`,
      room_id: roomId,
      type: 'm.room.redaction',
      sender: value.sender,
      content: {},
      redacts: value.event_id,
    },
  },
});

it('refreshes an omitted retained origin to recover a missed redaction', async () => {
  const { mx, scheduler } = setup();
  const retained = new MatrixEvent(original);
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: [] });
  const fetch = vi.spyOn(mx, 'fetchRoomEvent').mockResolvedValue(redacted(original));
  const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId, undefined, [
    retained,
  ]);
  expect(fetch).toHaveBeenCalledWith(roomId, '$approval');
  expect(result.events[0].isRedacted()).toBe(true);
  expect(collectThreadApprovals([retained, ...result.events], roomId, threadId)).toEqual([]);
});

it('refreshes an omitted retained edit without fetching unrelated origins during targeted repair', async () => {
  const { mx, scheduler } = setup();
  const retained = new MatrixEvent(original);
  const rawEdit = {
    ...original,
    event_id: '$edit',
    content: {
      ...original.content,
      'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
      'm.new_content': { ...original.content, status: 'approved' },
    },
  };
  const edit = new MatrixEvent(rawEdit);
  retained.makeReplaced(edit);
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: [] });
  const fetch = vi.spyOn(mx, 'fetchRoomEvent').mockResolvedValue(redacted(rawEdit));
  const result = await enqueueThreadApprovalBackfill(
    mx,
    scheduler,
    roomId,
    threadId,
    [retained],
    [retained, edit]
  );
  expect(fetch.mock.calls).toEqual([[roomId, '$edit']]);
  expect(
    collectThreadApprovals([retained, edit, ...result.events], roomId, threadId)[0].approval.status
  ).toBe('pending');
});

it('does not infer deletions or refresh omissions when discovery fails partway', async () => {
  const { mx, scheduler } = setup();
  vi.spyOn(mx, 'fetchRelations').mockRejectedValue(new Error('Offline'));
  const fetch = vi.spyOn(mx, 'fetchRoomEvent');
  const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId, undefined, [
    new MatrixEvent(original),
  ]);
  expect(result.error).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

describe('thread approval backfill', () => {
  it('drains empty pages and repairs an old decision outside the visible timeline', async () => {
    const { mx, scheduler } = setup();
    const edit = {
      ...original,
      event_id: '$decision',
      origin_server_ts: 2,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$approval' },
        'm.new_content': { ...original.content, status: 'approved' },
      },
    };
    const fetch = vi
      .spyOn(mx, 'fetchRelations')
      .mockResolvedValueOnce({ chunk: [], next_batch: 'next' })
      .mockResolvedValueOnce({ chunk: [original] })
      .mockResolvedValueOnce({ chunk: [edit] });
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.error).toBeUndefined();
    expect(fetch.mock.calls.map((call) => [call[1], call[4]?.from])).toEqual([
      [threadId, undefined],
      [threadId, 'next'],
      ['$approval', undefined],
    ]);
    expect(collectThreadApprovals(result.events, roomId, threadId)[0].approval.status).toBe(
      'approved'
    );
    expect(result.repairedEventIds).toEqual(['$approval']);
  });
  it('retains undecrypted events for late-key recovery instead of silently discarding them', async () => {
    const { mx, room, scheduler } = setup();
    vi.spyOn(room, 'hasEncryptionStateEvent').mockReturnValue(true);
    const encrypted = {
      ...original,
      type: 'm.room.encrypted',
      content: { ciphertext: 'waiting for keys' },
    };
    vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: [encrypted] });
    const decrypt = vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue();
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].getType()).toBe('m.room.encrypted');
    expect(decrypt).toHaveBeenCalledWith(result.events[0]);
    expect(result.repairedEventIds).toEqual([]);
  });
  it('returns partial history with an error and never loops on repeated pagination tokens', async () => {
    const { mx, scheduler } = setup();
    const fetch = vi
      .spyOn(mx, 'fetchRelations')
      .mockResolvedValue({ chunk: [original], next_batch: 'same' });
    const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    expect(result.error).toBeTruthy();
    expect(result.events.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('stops before another request after a running job is cancelled', async () => {
    const { mx, scheduler } = setup();
    let release!: (value: { chunk: typeof original[]; next_batch: string }) => void;
    const fetch = vi.spyOn(mx, 'fetchRelations').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const job = enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
    const outcome = job.catch(() => undefined);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    scheduler.abort(roomId, threadId, 'thread-approvals');
    release({ chunk: [original], next_batch: 'more' });
    await outcome;
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it('retains the complete page when one unexpected decryption failure rejects', async () => {
  const { mx, room, scheduler } = setup();
  vi.spyOn(room, 'hasEncryptionStateEvent').mockReturnValue(true);
  const encrypted = {
    ...original,
    event_id: '$encrypted',
    type: 'm.room.encrypted',
    content: { ciphertext: 'late keys' },
  };
  vi.spyOn(mx, 'fetchRelations')
    .mockResolvedValueOnce({ chunk: [original, encrypted] })
    .mockResolvedValue({ chunk: [] });
  vi.spyOn(mx, 'decryptEventIfNeeded').mockImplementation(async (event) => {
    if (event.getId() === '$encrypted') throw new Error('Crypto unavailable');
  });
  const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId);
  expect(result.events.map((event) => event.getId())).toEqual(['$approval', '$encrypted']);
  expect(result.error).toContain('decrypt');
});

it('reports a missing room instead of claiming discovery or repair completed', async () => {
  const { mx, scheduler } = setup();
  vi.spyOn(mx, 'getRoom').mockReturnValue(null);
  const result = await enqueueThreadApprovalBackfill(mx, scheduler, roomId, threadId, [
    new MatrixEvent(original),
  ]);
  expect(result.repairedEventIds).toEqual([]);
  expect(result.error).toBeTruthy();
});
