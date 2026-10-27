import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore } from 'jotai';
import { EventStatus } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

// The composer extensions pull in editor styles; a room-level voice message has no relation.
vi.mock('./RoomInputMindroomExtensions', () => ({
  getMindroomRoomInputVoiceUploadRelation: () => undefined,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('useRoomInputUploadTransport voice sends', () => {
  it('drops the unsent echo of a failed voice message that the recorder keeps', async () => {
    const localEvents = new Map<string, { status: EventStatus }>();
    const failure = new Error('voice send failed');
    const mx = {
      makeTxnId: () => 'txn-voice',
      sendMessage: vi.fn(async (_roomId: string, _content: unknown, txnId: string) => {
        localEvents.set(txnId, { status: EventStatus.NOT_SENT });
        throw failure;
      }),
      cancelPendingEvent: vi.fn(),
    };
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: (txnId: string) => localEvents.get(txnId),
    };
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    const Harness = () => {
      transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    const file = new File(['voice'], 'voice.txt', { type: 'text/plain' });

    await expect(
      transport.sendVoiceItem(
        {
          ownerSessionId: '@alice:example.org',
          roomId: room.roomId,
          room: room as never,
          threadId: undefined,
          replyDraft: undefined,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } },
        'mxc://example.org/voice'
      )
    ).rejects.toBe(failure);

    expect(mx.sendMessage.mock.calls[0][2]).toBe('txn-voice');
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(localEvents.get('txn-voice'));
  });
});
