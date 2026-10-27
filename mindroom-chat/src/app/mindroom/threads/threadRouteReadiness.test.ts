import { MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isThreadRouteReady } from './threadRouteUtils';

const makeRoom = () => ({
  getThread: vi.fn<Room['getThread']>().mockReturnValue(null),
  findEventById: vi.fn<Room['findEventById']>().mockReturnValue(undefined),
});

describe('thread route readiness', () => {
  it('allows room-level actions without looking up an absent thread route', () => {
    const room = makeRoom();
    expect(isThreadRouteReady(room, undefined)).toBe(true);
    expect(room.getThread).not.toHaveBeenCalled();
    expect(room.findEventById).not.toHaveBeenCalled();
  });

  it('accepts a known SDK root without a room-wide search', () => {
    const room = makeRoom();
    room.getThread.mockReturnValue({ rootEvent: new MatrixEvent({ event_id: '$root' }) } as Thread);
    expect(isThreadRouteReady(room, '$root')).toBe(true);
    expect(room.findEventById).not.toHaveBeenCalled();
  });

  it('accepts a loaded route event before its SDK thread exists', () => {
    const room = makeRoom();
    room.findEventById.mockReturnValue(new MatrixEvent({ event_id: '$reply' }));
    expect(isThreadRouteReady(room, '$reply')).toBe(true);
    expect(room.findEventById).toHaveBeenCalledWith('$reply');
  });

  it('keeps an unknown route unready even if its SDK model lacks a root', () => {
    const room = makeRoom();
    room.getThread.mockReturnValue({ rootEvent: undefined } as Thread);
    expect(isThreadRouteReady(room, '$missing')).toBe(false);
    expect(room.findEventById).toHaveBeenCalledWith('$missing');
  });
});
