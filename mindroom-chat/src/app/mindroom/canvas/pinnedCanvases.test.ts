import type { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { PINNED_CANVASES_TYPE, readPinnedCanvases, setCanvasPinned } from './pinnedCanvases';

/** A client whose writes settle only once the test echoes them, as the SDK's do. */
const client = (initial: unknown) => {
  let content = initial;
  const echoes: Array<() => void> = [];
  const setAccountData = vi.fn(
    (_type: string, next: unknown) =>
      new Promise<void>((resolve) => {
        echoes.push(() => {
          content = next;
          resolve();
        });
      })
  );
  const mx = {
    getAccountData: () => (content ? { getContent: () => content } : undefined),
    setAccountData,
  } as unknown as MatrixClient;
  const echo = async () => {
    echoes.shift()?.();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  };
  return { mx, setAccountData, echo };
};

describe('pinnedCanvases', () => {
  it('reads valid pins once each, in order', () => {
    expect(
      readPinnedCanvases({
        canvases: [
          { room_id: '!a:example.org', event_id: '$one' },
          { room_id: 'not-a-room', event_id: '$bad' },
          { room_id: '!a:example.org', event_id: 'not-an-event' },
          'junk',
          { room_id: '!b:example.org', event_id: '$two' },
          { room_id: '!b:example.org', event_id: '$one' },
        ],
      })
    ).toEqual([
      { roomId: '!a:example.org', canvasId: '$one' },
      { roomId: '!b:example.org', canvasId: '$two' },
    ]);
    expect(readPinnedCanvases(undefined)).toEqual([]);
    expect(readPinnedCanvases({ canvases: 'junk' })).toEqual([]);
  });

  it('writes room and event IDs only, one change at a time from the latest pins', async () => {
    const { mx, setAccountData, echo } = client({
      canvases: [{ room_id: '!a:example.org', event_id: '$one' }],
    });
    const two = { roomId: '!b:example.org', canvasId: '$two' };
    const writes = [
      setCanvasPinned(mx, two, true),
      setCanvasPinned(mx, { roomId: '!a:example.org', canvasId: '$one' }, false),
      // Pinning a pinned canvas keeps its place.
      setCanvasPinned(mx, two, true),
    ];
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    // The second change waits for the first to echo back, then starts from it.
    expect(setAccountData).toHaveBeenCalledTimes(1);
    expect(setAccountData).toHaveBeenLastCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [
        { room_id: '!a:example.org', event_id: '$one' },
        { room_id: '!b:example.org', event_id: '$two' },
      ],
    });
    await echo();
    expect(setAccountData).toHaveBeenLastCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [{ room_id: '!b:example.org', event_id: '$two' }],
    });
    await echo();
    expect(setAccountData).toHaveBeenLastCalledWith(PINNED_CANVASES_TYPE, {
      canvases: [{ room_id: '!b:example.org', event_id: '$two' }],
    });
    await echo();
    await Promise.all(writes);
  });

  it('runs the next change after a failed one', async () => {
    const setAccountData = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({});
    const mx = { getAccountData: () => undefined, setAccountData } as unknown as MatrixClient;
    const pin = { roomId: '!a:example.org', canvasId: '$one' };
    await expect(setCanvasPinned(mx, pin, true)).rejects.toThrow('offline');
    await setCanvasPinned(mx, pin, true);
    expect(setAccountData).toHaveBeenCalledTimes(2);
  });
});
