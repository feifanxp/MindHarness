import { MatrixEvent } from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as editEvent from '../../utils/editEvent';
import { mergeThreadApprovalEvents, ThreadApprovalEvents } from './threadApprovalEvents';
import { collectThreadApprovals } from './threadApprovalModel';

const roomId = '!room:example.org';
const threadId = '$thread';
const approvalType = 'io.mindroom.tool_approval';
const approvalContent = {
  approval_id: 'one',
  tool_name: 'invite',
  agent_name: 'assistant',
  arguments: { user: 'Jamie' },
  status: 'pending',
  requested_at: '2026-09-12T12:00:00Z',
  expires_at: '2999-09-12T12:00:00Z',
  thread_id: threadId,
};
const makeEvent = (id: string, type = approvalType) =>
  new MatrixEvent({
    event_id: id,
    room_id: roomId,
    sender: '@router:example.org',
    origin_server_ts: 1,
    type,
    content:
      type === approvalType ? approvalContent : { msgtype: 'm.text', body: 'Plain text message' },
  });
const empty = (): ThreadApprovalEvents => ({ events: new Map(), scopedEventIds: new Set() });
const merge = (old: ThreadApprovalEvents, incoming: MatrixEvent[]) =>
  mergeThreadApprovalEvents(old, incoming, roomId, threadId);
const replacement = (original: MatrixEvent, type = original.getType()) =>
  new MatrixEvent({
    ...original.event,
    event_id: `${original.getId()}-edit`,
    origin_server_ts: 2,
    type,
    content: {
      'm.relates_to': { rel_type: 'm.replace', event_id: original.getId() },
      'm.new_content':
        original.getType() === approvalType
          ? { ...approvalContent, status: 'approved' }
          : { msgtype: 'm.text', body: 'Edited message' },
    },
  });

afterEach(() => vi.restoreAllMocks());

describe('approval bundle relevance', () => {
  it('does not unpack or clone ordinary edited messages during repeated history scans', () => {
    const messages = Array.from({ length: 600 }, (_, index) => {
      const original = makeEvent(`$message-${index}`, 'm.room.message');
      original.setUnsigned({ 'm.relations': { 'm.replace': replacement(original).event } });
      return original;
    });
    const old = empty();
    const unpack = vi.spyOn(editEvent, 'getSerializedReplacementEvent');
    const clone = vi.spyOn(globalThis, 'structuredClone');

    for (let scan = 0; scan < 3; scan += 1) expect(merge(old, messages)).toBe(old);

    expect({ unpack: unpack.mock.calls.length, clone: clone.mock.calls.length }).toEqual({
      unpack: 0,
      clone: 0,
    });
    expect(messages[0].getUnsigned()['m.relations']?.['m.replace']).toBeDefined();
  });

  it.each(['serialized', 'attached'] as const)('keeps %s approval decisions', (kind) => {
    const original = makeEvent('$approval');
    const edit = replacement(original);
    if (kind === 'serialized') original.setUnsigned({ 'm.relations': { 'm.replace': edit.event } });
    else original.makeReplaced(edit);

    const retained = merge(empty(), [original]);

    expect([...retained.events.keys()]).toEqual(['$approval', '$approval-edit']);
    expect(
      collectThreadApprovals([...retained.events.values()], roomId, threadId)[0].approval.status
    ).toBe('approved');
  });

  it.each(['ciphertext', 'failed decryption'] as const)(
    'keeps bundled edit evidence on %s originals',
    async (kind) => {
      const original = new MatrixEvent({
        ...makeEvent('$encrypted').event,
        type: 'm.room.encrypted',
        content: { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } },
      });
      if (kind === 'failed decryption') {
        await original.attemptDecryption({
          decryptEvent: async () => {
            throw new Error('Missing key');
          },
        } as CryptoBackend);
        expect(original.getType()).toBe('m.room.message');
      }
      original.setUnsigned({
        'm.relations': { 'm.replace': replacement(original, 'm.room.encrypted').event },
      });

      const retained = merge(empty(), [original]);

      expect([...retained.events.keys()]).toEqual(['$encrypted', '$encrypted-edit']);
    }
  );

  it.each(['retained', 'scoped'] as const)(
    'keeps bundled tombstones from %s former candidates after their type becomes ordinary',
    (kind) => {
      const original = makeEvent('$former', 'm.room.message');
      const edit = replacement(original);
      edit.setUnsigned({ redacted_because: { type: 'm.room.redaction', content: {} } });
      original.setUnsigned({ 'm.relations': { 'm.replace': edit.event } });
      const old: ThreadApprovalEvents = {
        events: kind === 'retained' ? new Map([['$former', original]]) : new Map(),
        scopedEventIds: kind === 'scoped' ? new Set(['$former']) : new Set(),
      };

      const retained = merge(old, [original]);

      expect(retained.events.has('$former')).toBe(false);
      expect(retained.events.get('$former-edit')?.isRedacted()).toBe(true);
    }
  );

  it('still retains original tombstones and early redactions among ordinary messages', () => {
    const tombstone = makeEvent('$removed', 'm.room.message');
    tombstone.setUnsigned({ redacted_because: { type: 'm.room.redaction', content: {} } });
    const redaction = new MatrixEvent({
      ...makeEvent('$redaction').event,
      type: 'm.room.redaction',
      redacts: '$approval',
      content: {},
    });

    const retained = merge(empty(), [
      makeEvent('$ordinary', 'm.room.message'),
      tombstone,
      redaction,
    ]);

    expect([...retained.events.keys()]).toEqual(['$removed', '$redaction']);
    expect(retained.events.get('$removed')).toBe(tombstone);
    expect(retained.events.get('$redaction')).toBe(redaction);
  });
});
