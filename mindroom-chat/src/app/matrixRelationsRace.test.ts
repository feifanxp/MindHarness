import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { describe, expect, it, vi } from 'vitest';

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@bob:example.com'
) =>
  new MatrixEvent({
    content: {
      body: `edited ${eventId}`,
      'm.new_content': {
        body: `edited ${eventId}`,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.com',
    sender,
    type: 'm.room.message',
  });

describe('matrix-js-sdk m.replace race backport', () => {
  it('does not let a slow older edit overwrite a newer edit', async () => {
    const targetEventId = '$target';
    const targetEvent = new MatrixEvent({
      content: {
        body: 'original',
        msgtype: 'm.text',
      },
      event_id: targetEventId,
      origin_server_ts: 1000,
      room_id: '!room:example.com',
      sender: '@bob:example.com',
      type: 'm.room.message',
    });

    const relations = new Relations(RelationType.Replace, 'm.room.message', {
      getCrypto: () => null,
    } as any);
    await relations.setTargetEvent(targetEvent);

    const olderEdit = makeEditEvent('$edit1', 2000, targetEventId);
    const newerEdit = makeEditEvent('$edit2', 3000, targetEventId);

    let resolveOlderDecryption: () => void = () => undefined;
    const olderDecryptionPromise = new Promise<void>((resolve) => {
      resolveOlderDecryption = resolve;
    });

    vi.spyOn(olderEdit, 'isBeingDecrypted').mockReturnValue(true);
    vi.spyOn(olderEdit, 'getDecryptionPromise').mockReturnValue(olderDecryptionPromise);
    vi.spyOn(olderEdit, 'shouldAttemptDecryption').mockReturnValue(false);

    vi.spyOn(newerEdit, 'isBeingDecrypted').mockReturnValue(false);
    vi.spyOn(newerEdit, 'shouldAttemptDecryption').mockReturnValue(false);

    const addOlderPromise = relations.addEvent(olderEdit);

    await relations.addEvent(newerEdit);
    expect(targetEvent.replacingEvent()).toBe(newerEdit);

    resolveOlderDecryption();
    await addOlderPromise;

    expect(targetEvent.replacingEvent()).toBe(newerEdit);
  });
});
