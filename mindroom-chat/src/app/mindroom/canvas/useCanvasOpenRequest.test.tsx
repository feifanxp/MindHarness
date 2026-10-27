// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelCanvasOpen, requestCanvasOpen, useCanvasOpenRequest } from './useCanvasOpenRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loads = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./canvasIndex', () => ({ loadCanvasEvent: loads.load }));

const mx = {} as MatrixClient;
const room = { roomId: '!room:example.org' } as Room;
const canvas = { getId: () => '$canvas' } as MatrixEvent;

const render = (enabled = true) => {
  const open = vi.fn();
  function Opener() {
    useCanvasOpenRequest(mx, room, enabled, open);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Opener />));
  return { open, root };
};

const deferred = () => {
  let resolve: (event: MatrixEvent) => void = () => undefined;
  loads.load.mockReturnValueOnce(
    new Promise<MatrixEvent>((done) => {
      resolve = done;
    })
  );
  return (event: MatrixEvent) => resolve(event);
};

beforeEach(() => {
  loads.load.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCanvasOpenRequest', () => {
  it('opens the canvas requested for this room once, after it has loaded', async () => {
    loads.load.mockResolvedValue(canvas);
    requestCanvasOpen(room.roomId, '$canvas');
    const first = render();
    await act(async () => undefined);
    expect(loads.load).toHaveBeenCalledWith(mx, room, '$canvas');
    expect(first.open).toHaveBeenCalledWith(canvas);
    act(() => first.root.unmount());
    // A later visit does not open it again.
    const later = render();
    await act(async () => undefined);
    expect(later.open).not.toHaveBeenCalled();
    act(() => later.root.unmount());
  });

  it('waits until the room is ready, and leaves requests for other rooms alone', async () => {
    loads.load.mockResolvedValue(canvas);
    requestCanvasOpen('!other:example.org', '$canvas');
    const other = render();
    requestCanvasOpen(room.roomId, '$canvas');
    const waiting = render(false);
    await act(async () => undefined);
    expect(loads.load).not.toHaveBeenCalled();
    act(() => waiting.root.unmount());
    const ready = render();
    await act(async () => undefined);
    expect(ready.open).toHaveBeenCalledWith(canvas);
    expect(other.open).not.toHaveBeenCalled();
    [other, ready].forEach(({ root }) => act(() => root.unmount()));
  });

  it('is opened by the room mounted when the canvas loads, also after a remount', async () => {
    const resolveFirst = deferred();
    const resolveSecond = deferred();
    requestCanvasOpen(room.roomId, '$canvas');
    const first = render();
    // Thread routing can remount the room while the canvas loads.
    act(() => first.root.unmount());
    const second = render();
    await act(async () => resolveFirst(canvas));
    expect(first.open).not.toHaveBeenCalled();
    await act(async () => resolveSecond(canvas));
    expect(second.open).toHaveBeenCalledTimes(1);
    act(() => second.root.unmount());
  });

  it('drops a request cancelled before the room opened it', async () => {
    const resolve = deferred();
    requestCanvasOpen(room.roomId, '$canvas');
    const first = render();
    // The user went back to the Canvases page, then chose only the conversation.
    act(() => first.root.unmount());
    cancelCanvasOpen();
    const second = render();
    await act(async () => resolve(canvas));
    expect(loads.load).toHaveBeenCalledTimes(1);
    expect(second.open).not.toHaveBeenCalled();
    act(() => second.root.unmount());
  });

  it('forgets a request no room opened in time, and one whose canvas cannot load', async () => {
    vi.useFakeTimers();
    requestCanvasOpen(room.roomId, '$stale');
    vi.advanceTimersByTime(31_000);
    const stale = render();
    expect(loads.load).not.toHaveBeenCalled();
    act(() => stale.root.unmount());
    vi.useRealTimers();

    loads.load.mockResolvedValue(undefined);
    requestCanvasOpen(room.roomId, '$missing');
    const missing = render();
    await act(async () => undefined);
    expect(missing.open).not.toHaveBeenCalled();
    act(() => missing.root.unmount());
    const again = render();
    await act(async () => undefined);
    expect(loads.load).toHaveBeenCalledTimes(1);
    act(() => again.root.unmount());
  });
});
