import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import {
  createClient,
  EventStatus,
  MatrixEvent,
  PendingEventOrdering,
  Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createMindroomSyncEngine } from '../engine/mindroomSyncEngine';
import { useThreadRenderState } from './useThreadRenderState';

type Snapshot = ReturnType<typeof useThreadRenderState>;
const Harness = ({
  room,
  threadId,
  onRender,
}: {
  room: Room;
  threadId: string;
  onRender: (state: Snapshot) => void;
}) => {
  onRender(
    useThreadRenderState({
      room,
      threadId,
      thread: null,
      roomTimelineSet: room.getUnfilteredTimelineSet(),
      threadInitialCacheHydrated: false,
    })
  );
  return null;
};

describe('pending thread replies across navigation', () => {
  let renderer: ReactTestRenderer | undefined;
  let engine: ReturnType<typeof createMindroomSyncEngine> | undefined;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    engine?.stop();
  });

  const setup = () => {
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      timelineSupport: true,
      threadSupport: true,
    });
    // startClient normally enables this; keep networking stopped in this test.
    mx.supportsThreads = () => true;
    const room = new Room('!room:example.org', mx, '@alice:example.org', {
      pendingEventOrdering: PendingEventOrdering.Chronological,
      timelineSupport: true,
    });
    mx.store.storeRoom(room);
    mx.reEmitter.reEmit(room, [RoomEvent.LocalEchoUpdated]);
    engine = createMindroomSyncEngine({ mx });
    engine.start();
    let state: Snapshot;
    const open = (threadId = '$root', targetRoom = room) => {
      act(() => {
        renderer = create(
          React.createElement(Harness, {
            room: targetRoom,
            threadId,
            onRender: (snapshot) => {
              state = snapshot;
            },
          })
        );
      });
      return state!;
    };
    const close = () => {
      act(() => renderer?.unmount());
      renderer = undefined;
    };
    const reply = new MatrixEvent({
      event_id: '~local-reply',
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 2,
      content: {
        body: 'Offline reply',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    });
    reply.setStatus(EventStatus.SENDING);
    reply.setTxnId('txn-reply');
    return { mx, room, reply, open, close, state: () => state! };
  };

  it('restores the original pending event after leaving and reopening an offline thread', () => {
    const { room, reply, open, close, state } = setup();
    open();
    act(() => room.addPendingEvent(reply, 'txn-reply'));
    expect(state().threadEvents).toContain(reply);
    expect(room.getLiveTimeline().getEvents()).not.toContain(reply);
    close();
    expect(open().threadEvents).toContain(reply);
    expect(state().threadEvents[0].status).toBe(EventStatus.SENDING);
    expect(state().threadInitialRenderMode).not.toBe('loading');
    act(() => {
      room.updatePendingEvent(reply, EventStatus.NOT_SENT);
      room.updatePendingEvent(reply, EventStatus.CANCELLED);
    });
    expect(state().threadEvents).toEqual([]);
  });

  it.each([EventStatus.QUEUED, EventStatus.NOT_SENT, EventStatus.SENT])(
    'keeps %s replies received before a thread view or initial sync exists',
    (status) => {
      const { room, reply, open } = setup();
      room.addPendingEvent(reply, 'txn-reply');
      room.updatePendingEvent(reply, status, status === EventStatus.SENT ? '$sent' : undefined);
      expect(open().threadEvents).toEqual([reply]);
      expect(reply.status).toBe(status);
    }
  );

  it.each(['cancelled', 'confirmed'] as const)(
    'does not restore a reply %s while closed',
    (result) => {
      const { room, reply, open, close } = setup();
      room.addPendingEvent(reply, 'txn-reply');
      expect(open().threadEvents).toContain(reply);
      close();
      if (result === 'cancelled') {
        room.updatePendingEvent(reply, EventStatus.NOT_SENT);
        room.updatePendingEvent(reply, EventStatus.CANCELLED);
      } else {
        room.updatePendingEvent(reply, EventStatus.SENT, '$sent');
        room.handleRemoteEcho(
          new MatrixEvent({
            ...reply.event,
            event_id: '$sent',
            unsigned: { transaction_id: 'txn-reply' },
          }),
          reply
        );
      }
      expect(open().threadEvents).toEqual([]);
    }
  );

  it('isolates pending events by thread and room object', () => {
    const { mx, room, reply, open, close } = setup();
    room.addPendingEvent(reply, 'txn-reply');
    expect(open('$other').threadEvents).toEqual([]);
    close();
    const otherRoom = new Room(room.roomId, mx, '@other:example.org');
    expect(open('$root', otherRoom).threadEvents).toEqual([]);
    close();
    expect(open().threadEvents).toEqual([reply]);
  });

  it('detaches capture when the client engine stops', () => {
    const { room, reply, open } = setup();
    engine!.stop();
    room.addPendingEvent(reply, 'txn-reply');
    expect(open().threadEvents).toEqual([]);
  });

  it('deduplicates a confirmed reply against the retained transaction after reopening', () => {
    const { room, reply, open, close, state } = setup();
    room.addPendingEvent(reply, 'txn-reply');
    open();
    close();
    open();
    act(() => room.updatePendingEvent(reply, EventStatus.SENT, '$confirmed'));
    const confirmed = new MatrixEvent({
      ...reply.event,
      event_id: '$confirmed',
      unsigned: { transaction_id: 'txn-reply' },
    });
    act(() => state().setSupplementalThreadEvents('$root', [confirmed]));
    expect(state().threadEvents).toHaveLength(1);
    act(() => room.handleRemoteEcho(confirmed, reply));
    expect(state().threadEvents).toHaveLength(1);
    expect(state().threadEvents[0].status).toBeNull();
  });
});
