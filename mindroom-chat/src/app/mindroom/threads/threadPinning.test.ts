import { describe, expect, it, vi } from 'vitest';
import { ClientEvent, createClient, MatrixEvent, Room, SyncState } from 'matrix-js-sdk';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { StateEvent } from '../../../types/matrix/room';
import { canPinRoomEvents, isThreadPinned, setRoomEventPinned } from './threadPinning';
import { usePinnedEventIds } from './useThreadPinning';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';

const admin = '@admin:example.org';
const syncPins = (room: Room, id: string, pinned: string[]) =>
  room.currentState.setStateEvents([
    new MatrixEvent({
      event_id: id,
      type: StateEvent.RoomPinnedEvents,
      state_key: '',
      room_id: room.roomId,
      content: { pinned },
    }),
  ]);
const makeRoom = (level = 100, required = 50) => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: admin });
  const room = new Room('!room:example.org', mx, admin);
  vi.spyOn(mx, 'getStateEvent').mockResolvedValue({ pinned: ['$older', '$reply'] });
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: StateEvent.RoomCreate,
      state_key: '',
      room_id: room.roomId,
      sender: admin,
      content: { room_version: '11', creator: admin },
    }),
    new MatrixEvent({
      type: StateEvent.RoomPowerLevels,
      state_key: '',
      room_id: room.roomId,
      content: { users: { [admin]: level }, events: { [StateEvent.RoomPinnedEvents]: required } },
    }),
    new MatrixEvent({
      type: StateEvent.RoomPinnedEvents,
      event_id: '$initial-pins',
      state_key: '',
      room_id: room.roomId,
      content: { pinned: ['$older', '$reply'] },
    }),
  ]);
  return { mx, room };
};

describe('room thread pins', () => {
  it.each([false, true])(
    'verifies an uncertain pin after reconnect (committed=%s)',
    async (committed) => {
      const { mx, room } = makeRoom();
      let serverPins = ['$older', '$reply'];
      vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
        if (committed) serverPins = (content as { pinned: string[] }).pinned;
        vi.mocked(mx.getStateEvent).mockRejectedValue(new Error('Offline'));
        throw new Error('Connection lost');
      });
      await expect(setRoomEventPinned(mx, room, '$root', true)).rejects.toThrow('Connection lost');
      expect(isThreadPinned(room, '$root')).toBe(true);
      vi.mocked(mx.getStateEvent).mockResolvedValue({ pinned: serverPins });
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Error);
      await vi.waitFor(() => {
        expect(mx.getStateEvent).toHaveBeenCalledTimes(3);
        expect(isThreadPinned(room, '$root')).toBe(committed);
      });
      syncPins(room, '$confirmed', serverPins);
      mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
      await Promise.resolve();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(3);
    }
  );
  it('follows pin state after a limited sync replaces the live RoomState', () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: admin });
    const room = new Room('!reset:example.org', mx, admin, { timelineSupport: true });
    syncPins(room, '$before-reset', ['$old']);
    let ids: string[] = [];
    function Probe() {
      ids = usePinnedEventIds(room);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    try {
      expect(ids).toEqual(['$old']);
      act(() => {
        room.resetLiveTimeline('back-token', 'forward-token');
        syncPins(room, '$after-reset', ['$new']);
      });
      expect(ids).toEqual(['$new']);
    } finally {
      act(() => renderer.unmount());
    }
  });
  it.each([true, false])(
    'accepts an unpin sync when its HTTP response and verification are lost (early=%s)',
    async (early) => {
      const { mx, room } = makeRoom();
      let serverPins: string[] = [];
      vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
        serverPins = (content as { pinned: string[] }).pinned;
        vi.mocked(mx.getStateEvent).mockRejectedValue(new Error('Offline'));
        if (early) syncPins(room, '$unpin-echo', serverPins);
        throw new Error('Response lost');
      });
      await expect(setRoomEventPinned(mx, room, '$older', false)).rejects.toThrow('Response lost');
      if (!early) syncPins(room, '$unpin-echo', serverPins);
      expect(isThreadPinned(room, '$older')).toBe(false);
    }
  );

  it.each([true, false])(
    'keeps a committed pin protected when its response is lost (readable=%s)',
    async (readable) => {
      const { mx, room } = makeRoom();
      let serverPins = ['$older', '$reply'];
      vi.mocked(mx.getStateEvent).mockImplementation(async () => ({ pinned: serverPins }));
      vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
        serverPins = (content as { pinned: string[] }).pinned;
        if (!readable) vi.mocked(mx.getStateEvent).mockRejectedValue(new Error('Offline'));
        throw new Error('Response lost');
      });
      const saving = setRoomEventPinned(mx, room, '$root', true);
      if (readable) await expect(saving).resolves.toBeUndefined();
      else await expect(saving).rejects.toThrow('Response lost');
      expect(isThreadPinned(room, '$root')).toBe(true);
      syncPins(room, '$saved', serverPins);
      syncPins(room, '$later-unpin', []);
      expect(isThreadPinned(room, '$root')).toBe(false);
    }
  );

  it('shares accepted pins with thread controls and the room pin menu before sync', async () => {
    const { mx, room } = makeRoom();
    vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$saved' });
    let threadPins: string[] = [];
    let menuPins: string[] = [];
    function Probe() {
      threadPins = usePinnedEventIds(room);
      menuPins = useRoomPinnedEvents(room);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Probe));
    });
    try {
      await act(async () => {
        await setRoomEventPinned(mx, room, '$root', true);
      });
      expect(threadPins).toEqual(['$older', '$reply', '$root']);
      expect(menuPins).toEqual(threadPins);
      act(() => syncPins(room, '$saved', threadPins));
      act(() => syncPins(room, '$removed-elsewhere', []));
      expect(threadPins).toEqual([]);
      expect(menuPins).toEqual([]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('guards queued pin intents even when an earlier save fails', async () => {
    const { mx, room } = makeRoom();
    const send = vi
      .spyOn(mx, 'sendStateEvent')
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValue({ event_id: '$second-saved' });
    const first = setRoomEventPinned(mx, room, '$first', true).catch(() => undefined);
    const second = setRoomEventPinned(mx, room, '$second', true);
    const guardedWhileQueued = isThreadPinned(room, '$second');
    await Promise.all([first, second]);
    expect(guardedWhileQueued).toBe(true);
    expect(isThreadPinned(room, '$first')).toBe(false);
    expect(isThreadPinned(room, '$second')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses confirmed server pins when a requested pin is already saved before sync', async () => {
    const { mx, room } = makeRoom();
    vi.mocked(mx.getStateEvent).mockResolvedValue({ pinned: ['$root'] });
    const send = vi.spyOn(mx, 'sendStateEvent');
    await setRoomEventPinned(mx, room, '$root', true);
    expect(isThreadPinned(room, '$root')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves both pins when saves finish before sync updates the room', async () => {
    const { mx, room } = makeRoom();
    let serverPins = ['$older', '$reply'];
    vi.mocked(mx.getStateEvent).mockImplementation(async () => ({ pinned: serverPins }));
    vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
      serverPins = (content as { pinned: string[] }).pinned;
      return { event_id: '$saved' };
    });
    await Promise.all([
      setRoomEventPinned(mx, room, '$first', true),
      setRoomEventPinned(mx, room, '$second', true),
    ]);
    expect(serverPins).toEqual(['$older', '$reply', '$first', '$second']);
    expect(isThreadPinned(room, '$first')).toBe(true);
    expect(isThreadPinned(room, '$second')).toBe(true);
  });

  it('keeps the latest pins while earlier saves echo, then follows later room state', async () => {
    const { mx, room } = makeRoom();
    let serverPins = ['$older', '$reply'];
    vi.mocked(mx.getStateEvent).mockImplementation(async () => ({ pinned: serverPins }));
    vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
      serverPins = (content as { pinned: string[] }).pinned;
      return { event_id: serverPins.includes('$second') ? '$save-second' : '$save-first' };
    });
    await setRoomEventPinned(mx, room, '$first', true);
    await setRoomEventPinned(mx, room, '$second', true);
    syncPins(room, '$save-first', ['$older', '$reply', '$first']);
    expect(isThreadPinned(room, '$second')).toBe(true);
    syncPins(room, '$save-second', serverPins);
    syncPins(room, '$other-client', ['$second']);
    expect(isThreadPinned(room, '$first')).toBe(false);
    expect(isThreadPinned(room, '$second')).toBe(true);
  });

  it('retains accepted pins when an unknown older sync response arrives late', async () => {
    const { mx, room } = makeRoom();
    const pins = ['$older', '$reply', '$root'];
    vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$saved' });
    await setRoomEventPinned(mx, room, '$root', true);
    vi.mocked(mx.getStateEvent).mockResolvedValue({ pinned: pins });
    syncPins(room, '$delayed-old-state', ['$older']);
    expect(isThreadPinned(room, '$root')).toBe(true);
    await vi.waitFor(() => expect(mx.getStateEvent).toHaveBeenCalledTimes(2));
    expect(isThreadPinned(room, '$root')).toBe(true);
    vi.mocked(mx.getStateEvent).mockResolvedValue({ pinned: [] });
    syncPins(room, '$removed-elsewhere', []);
    await vi.waitFor(() => expect(isThreadPinned(room, '$root')).toBe(false));
  });

  it.each([false, true])(
    'keeps alternating saves protected through delayed echoes (initiallyPinned=%s)',
    async (initiallyPinned) => {
      const { mx, room } = makeRoom();
      let serverPins = ['$older', '$reply'];
      if (initiallyPinned) serverPins.push('$root');
      syncPins(room, '$initial', serverPins);
      const saves: { id: string; pins: string[] }[] = [];
      vi.mocked(mx.getStateEvent).mockImplementation(async () => ({ pinned: serverPins }));
      vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
        serverPins = (content as { pinned: string[] }).pinned;
        const id = `$save-${saves.length}`;
        saves.push({ id, pins: serverPins });
        return { event_id: id };
      });
      await setRoomEventPinned(mx, room, '$root', true);
      await setRoomEventPinned(mx, room, '$root', false);
      await setRoomEventPinned(mx, room, '$root', true);
      if (initiallyPinned) await setRoomEventPinned(mx, room, '$root', true);
      expect(isThreadPinned(room, '$root')).toBe(true);
      saves.forEach(({ id, pins }) => {
        syncPins(room, id, pins);
        expect(isThreadPinned(room, '$root')).toBe(true);
      });
      serverPins = [];
      syncPins(room, '$remote-unpin', serverPins);
      await vi.waitFor(() => expect(isThreadPinned(room, '$root')).toBe(false));
    }
  );

  it('continues blocking resolution until an unpin request is accepted', async () => {
    const { mx, room } = makeRoom();
    let acceptSave!: (value: { event_id: string }) => void;
    const send = vi.spyOn(mx, 'sendStateEvent').mockImplementation(
      () =>
        new Promise((resolve) => {
          acceptSave = resolve;
        })
    );
    const saving = setRoomEventPinned(mx, room, '$older', false);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(isThreadPinned(room, '$older')).toBe(true);
    acceptSave({ event_id: '$unpinned' });
    await saving;
    expect(isThreadPinned(room, '$older')).toBe(false);
  });

  it('guards a pin during its request and restores the earlier accepted pins if saving fails', async () => {
    const { mx, room } = makeRoom();
    const accepted = ['$older', '$reply', '$first'];
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$save-first' });
    await setRoomEventPinned(mx, room, '$first', true);
    vi.mocked(mx.getStateEvent).mockResolvedValue({ pinned: accepted });
    let rejectSave!: (error: Error) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    const saving = setRoomEventPinned(mx, room, '$second', true);
    const rejection = expect(saving).rejects.toThrow('Unavailable');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(isThreadPinned(room, '$second')).toBe(true);
    rejectSave(new Error('Unavailable'));
    await rejection;
    expect(isThreadPinned(room, '$second')).toBe(false);
    expect(isThreadPinned(room, '$first')).toBe(true);
  });

  it('accepts a sync echo arriving before the HTTP response', async () => {
    const { mx, room } = makeRoom();
    vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
      syncPins(room, '$saved', (content as { pinned: string[] }).pinned);
      return { event_id: '$saved' };
    });
    await setRoomEventPinned(mx, room, '$root', true);
    expect(isThreadPinned(room, '$root')).toBe(true);
    syncPins(room, '$removed-elsewhere', []);
    expect(isThreadPinned(room, '$root')).toBe(false);
  });

  it.each([true, false])(
    'reconciles a newer remote pin received before HTTP settles (success=%s)',
    async (success) => {
      const { mx, room } = makeRoom();
      let serverPins = ['$older', '$reply'];
      vi.mocked(mx.getStateEvent).mockImplementation(async () => ({ pinned: serverPins }));
      vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
        syncPins(room, '$own-echo', (content as { pinned: string[] }).pinned);
        serverPins = ['$remote'];
        syncPins(room, '$newer-remote', serverPins);
        if (!success) throw new Error('Request interrupted');
        return { event_id: '$own-echo' };
      });
      await setRoomEventPinned(mx, room, '$root', true).catch(() => undefined);
      await vi.waitFor(() => expect(isThreadPinned(room, '$root')).toBe(false));
      expect(isThreadPinned(room, '$remote')).toBe(true);
    }
  );

  it('can create the first pin when the room has no pinned state event', async () => {
    const { mx, room } = makeRoom();
    vi.mocked(mx.getStateEvent).mockRejectedValue({ errcode: 'M_NOT_FOUND' });
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$saved' });
    await setRoomEventPinned(mx, room, '$root', true);
    expect(send).toHaveBeenCalledWith(
      room.roomId,
      StateEvent.RoomPinnedEvents,
      { pinned: ['$root'] },
      ''
    );
  });
  it.each([0, 50, 99])('rejects power %i even when the room permits state edits', async (level) => {
    const { mx, room } = makeRoom(level, 0);
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$pin' });
    await expect(setRoomEventPinned(mx, room, '$root', true)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('honors stricter room permissions and privileged room creators', () => {
    const powers = { users: { [admin]: 100 }, events: { [StateEvent.RoomPinnedEvents]: 150 } };
    expect(canPinRoomEvents(new Set(), powers, admin)).toBe(false);
    expect(canPinRoomEvents(new Set([admin]), powers, admin)).toBe(true);
  });

  it('appends a pin while preserving other message pins', async () => {
    const { mx, room } = makeRoom();
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$pin' });
    await setRoomEventPinned(mx, room, '$root', true);
    expect(send).toHaveBeenLastCalledWith(
      room.roomId,
      StateEvent.RoomPinnedEvents,
      { pinned: ['$older', '$reply', '$root'] },
      ''
    );
  });

  it('removes only the selected pin', async () => {
    const { mx, room } = makeRoom();
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$pin' });
    await setRoomEventPinned(mx, room, '$older', false);
    expect(send).toHaveBeenLastCalledWith(
      room.roomId,
      StateEvent.RoomPinnedEvents,
      { pinned: ['$reply'] },
      ''
    );
  });

  it('does not publish local echo IDs', async () => {
    const { mx, room } = makeRoom();
    const send = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$pin' });
    await expect(setRoomEventPinned(mx, room, '~pending', true)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
