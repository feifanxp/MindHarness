import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { EventType, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_FAILURE_CONTENT_KEY } from './callFailureNotice';
import { useCallFailureNotice } from './useCallFailureNotice';

const mocks = vi.hoisted(() => ({
  handler: undefined as ((...args: any[]) => Promise<void>) | undefined,
  mx: {
    decryptEventIfNeeded: vi.fn(),
    getUserId: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  liveEvents: [] as MatrixEvent[],
  room: {
    roomId: '!call:example.org',
    getLiveTimeline: () => ({ getEvents: () => mocks.liveEvents }),
  },
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

let observed: ReturnType<typeof useCallFailureNotice>;

function Probe({ joined, startedAfterTs }: { joined: boolean; startedAfterTs?: number }) {
  observed = useCallFailureNotice(mocks.room as unknown as Room, joined, startedAfterTs);
  return null;
}

const markedEvent = ({
  eventId = '$failure',
  timestamp = 123,
  sender = '@mindroom_agent:example.org',
}: {
  eventId?: string;
  timestamp?: number;
  sender?: string;
} = {}) =>
  new MatrixEvent({
    event_id: eventId,
    origin_server_ts: timestamp,
    room_id: mocks.room.roomId,
    sender,
    type: EventType.RoomMessage,
    content: {
      msgtype: 'm.notice',
      body: 'Voice call error: update the credential and restart MindRoom.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    },
  });

const emitTimeline = async (event: MatrixEvent, liveEvent = true) => {
  await mocks.handler?.(event, mocks.room, false, false, { liveEvent });
};

describe('useCallFailureNotice', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handler = undefined;
    mocks.liveEvents = [];
    mocks.mx.decryptEventIfNeeded.mockResolvedValue(undefined);
    mocks.mx.getUserId.mockReturnValue('@alice:example.org');
    mocks.mx.on.mockImplementation((event, handler) => {
      if (event === RoomEvent.Timeline) mocks.handler = handler;
    });
    observed = undefined;
  });

  it('shows only marked live notices received while the call is joined', async () => {
    act(() => {
      renderer = create(<Probe joined />);
    });

    await act(async () => emitTimeline(markedEvent(), false));
    expect(observed).toBeUndefined();

    await act(async () =>
      emitTimeline(
        new MatrixEvent({
          event_id: '$ordinary',
          origin_server_ts: 124,
          room_id: mocks.room.roomId,
          sender: '@mindroom_agent:example.org',
          type: EventType.RoomMessage,
          content: { msgtype: 'm.notice', body: 'Ordinary notice.' },
        })
      )
    );
    expect(observed).toBeUndefined();

    await act(async () => emitTimeline(markedEvent()));
    expect(observed).toEqual({
      eventId: '$failure',
      message: 'Voice call error: update the credential and restart MindRoom.',
    });

    act(() => renderer.update(<Probe joined={false} />));
    expect(observed).toBeUndefined();
    expect(mocks.mx.removeListener).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
  });

  it('waits for encrypted failure notices to decrypt', async () => {
    act(() => {
      renderer = create(<Probe joined />);
    });
    const event = markedEvent();
    vi.spyOn(event, 'isEncrypted').mockReturnValue(true);
    vi.spyOn(event, 'isDecryptionFailure').mockReturnValue(false);

    await act(async () => emitTimeline(event));

    expect(mocks.mx.decryptEventIfNeeded).toHaveBeenCalledWith(event);
    expect(observed?.eventId).toBe('$failure');
    act(() => renderer.unmount());
  });

  it('catches a recent failure that raced with the joined listener', async () => {
    const event = markedEvent();
    vi.spyOn(event, 'getTs').mockReturnValue(Date.now());
    mocks.liveEvents = [event];

    await act(async () => {
      renderer = create(<Probe joined />);
      await Promise.resolve();
    });

    expect(observed?.eventId).toBe('$failure');
    act(() => renderer.unmount());
  });

  it("ignores an earlier call's notice in the history scan, not this call's", async () => {
    const newestAtStart = Date.now() - 10_000;
    mocks.liveEvents = [markedEvent({ eventId: '$previous', timestamp: newestAtStart })];

    await act(async () => {
      renderer = create(<Probe joined startedAfterTs={newestAtStart} />);
      await Promise.resolve();
    });
    expect(observed).toBeUndefined();
    act(() => renderer.unmount());

    mocks.liveEvents.push(markedEvent({ eventId: '$current', timestamp: newestAtStart + 1 }));
    await act(async () => {
      renderer = create(<Probe joined startedAfterTs={newestAtStart} />);
      await Promise.resolve();
    });
    expect(observed?.eventId).toBe('$current');
    act(() => renderer.unmount());
  });

  describe('with the device clock ahead of the homeserver', () => {
    const serverNow = Date.now();

    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(serverNow + 30_000);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows a current notice found by the history scan', async () => {
      mocks.liveEvents = [markedEvent({ eventId: '$current', timestamp: serverNow })];

      await act(async () => {
        renderer = create(<Probe joined startedAfterTs={serverNow - 5_000} />);
        await Promise.resolve();
      });

      expect(observed?.eventId).toBe('$current');
      act(() => renderer.unmount());
    });

    it('shows a notice delivered live, whatever its timestamp', async () => {
      await act(async () => {
        renderer = create(<Probe joined startedAfterTs={serverNow} />);
        await Promise.resolve();
      });

      await act(async () =>
        emitTimeline(markedEvent({ eventId: '$live', timestamp: serverNow - 1 }))
      );

      expect(observed?.eventId).toBe('$live');
      act(() => renderer.unmount());
    });
  });

  it('does not let a slower historical decryption replace a newer live failure', async () => {
    let resolveHistoryDecryption: (() => void) | undefined;
    const historyDecryption = new Promise<void>((resolve) => {
      resolveHistoryDecryption = resolve;
    });
    const now = Date.now();
    const older = markedEvent({ eventId: '$older', timestamp: now - 1_000 });
    vi.spyOn(older, 'isEncrypted').mockReturnValue(true);
    vi.spyOn(older, 'isDecryptionFailure').mockReturnValue(false);
    mocks.mx.decryptEventIfNeeded.mockImplementation((event) =>
      event === older ? historyDecryption : Promise.resolve()
    );
    mocks.liveEvents = [older];

    await act(async () => {
      renderer = create(<Probe joined />);
      await Promise.resolve();
    });
    expect(mocks.mx.decryptEventIfNeeded).toHaveBeenCalledWith(older);

    const newer = markedEvent({ eventId: '$newer', timestamp: now });
    await act(async () => emitTimeline(newer));
    expect(observed?.eventId).toBe('$newer');

    await act(async () => {
      resolveHistoryDecryption?.();
      await historyDecryption;
    });
    expect(observed?.eventId).toBe('$newer');
    act(() => renderer.unmount());
  });

  it('stops scanning recent encrypted events after cleanup', async () => {
    let resolveFirstDecryption: (() => void) | undefined;
    const firstDecryption = new Promise<void>((resolve) => {
      resolveFirstDecryption = resolve;
    });
    const first = markedEvent({ eventId: '$first', timestamp: Date.now() });
    const second = markedEvent({ eventId: '$second', timestamp: Date.now() - 1 });
    vi.spyOn(first, 'isEncrypted').mockReturnValue(true);
    vi.spyOn(first, 'isDecryptionFailure').mockReturnValue(false);
    vi.spyOn(second, 'isEncrypted').mockReturnValue(true);
    vi.spyOn(second, 'isDecryptionFailure').mockReturnValue(false);
    mocks.mx.decryptEventIfNeeded.mockImplementation((event) =>
      event === first ? firstDecryption : Promise.resolve()
    );
    mocks.liveEvents = [second, first];

    await act(async () => {
      renderer = create(<Probe joined />);
      await Promise.resolve();
    });
    expect(mocks.mx.decryptEventIfNeeded).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
    await act(async () => {
      resolveFirstDecryption?.();
      await firstDecryption;
    });

    expect(mocks.mx.decryptEventIfNeeded).toHaveBeenCalledTimes(1);
  });
});
