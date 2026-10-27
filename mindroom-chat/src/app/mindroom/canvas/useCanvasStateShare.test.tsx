// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSaved } from './canvasDocument';
import { CANVAS_STATE_EVENT_TYPE, useCanvasStateShare } from './useCanvasStateShare';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sidecars = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../messages/longTextSidecarUpload', () => ({
  uploadMindroomLongTextSidecar: sidecars.upload,
}));

const sendEvent = vi.fn();
const mx = { sendEvent, makeTxnId: () => 'txn' } as unknown as MatrixClient;
const room = { roomId: '!room:example.org', getEventForTxnId: () => undefined } as unknown as Room;
const reference = { rel_type: 'm.reference', event_id: '$canvas' };

let container: HTMLDivElement;
let root: Root;
let share: (saved: CanvasSaved) => void;

function Probe({ enabled }: { enabled: boolean }) {
  share = useCanvasStateShare(mx, room, '$canvas', enabled);
  return null;
}

const render = (enabled = true) =>
  act(() => {
    root.render(<Probe enabled={enabled} />);
  });
const sent = () => sendEvent.mock.calls.map(([, type, content]) => ({ type, content }));

beforeEach(() => {
  vi.useFakeTimers();
  sendEvent.mockReset().mockResolvedValue({ event_id: '$copy' });
  sidecars.upload.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useCanvasStateShare', () => {
  it('shares the latest state once the user pauses for two seconds, as a reference to the canvas', async () => {
    render();
    share({ json: '{"done":[]}' });
    share({ json: '{"done":["tent"]}', inputs: '{"#rate":"7"}' });
    await act(async () => {
      vi.advanceTimersByTime(1_999);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: {
          msgtype: 'm.notice',
          version: 1,
          json: '{"done":["tent"]}',
          inputs: '{"#rate":"7"}',
          'm.relates_to': reference,
        },
      },
    ]);
  });

  it('waits for a pause: each save starts the wait again', async () => {
    render();
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    share({ json: '2' });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(sent().map(({ content }) => content.json)).toEqual(['2']);
  });

  it('shares nothing for a canvas that does not share, nor the same state twice', async () => {
    render(false);
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sendEvent).not.toHaveBeenCalled();

    render(true);
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it('shares what is still waiting when the panel closes', async () => {
    render();
    share({ inputs: '{"#rate":"3"}' });
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: {
          msgtype: 'm.notice',
          version: 1,
          inputs: '{"#rate":"3"}',
          'm.relates_to': reference,
        },
      },
    ]);
  });

  it('sends a large state as a long-text sidecar that keeps the reference', async () => {
    sidecars.upload.mockResolvedValue({
      msgtype: 'm.file',
      url: 'mxc://x/y',
      'm.relates_to': reference,
    });
    render();
    const json = JSON.stringify({ notes: 'x'.repeat(50_000) });
    share({ json });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sidecars.upload).toHaveBeenCalledWith(
      mx,
      room,
      { msgtype: 'm.notice', version: 1, json, 'm.relates_to': reference },
      // A notice, inline or as a sidecar, so a room set to notify on every message stays quiet.
      { msgtype: 'm.notice', body: 'Canvas state', 'm.relates_to': reference }
    );
    expect(sent()).toEqual([
      {
        type: CANVAS_STATE_EVENT_TYPE,
        content: { msgtype: 'm.file', url: 'mxc://x/y', 'm.relates_to': reference },
      },
    ]);
  });

  it('sends one copy at a time, so a slow upload never lands after a newer copy', async () => {
    let finishUpload: (content: Record<string, unknown>) => void = () => undefined;
    sidecars.upload.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      })
    );
    render();
    share({ json: JSON.stringify({ notes: 'x'.repeat(50_000) }) });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    share({ json: '"small"' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      finishUpload({ msgtype: 'm.file', 'm.relates_to': reference });
    });
    expect(sent().map(({ content }) => content.json ?? content.msgtype)).toEqual([
      'm.file',
      '"small"',
    ]);
  });

  it('keeps copies in order across closing and reopening the panel', async () => {
    let finishUpload: (content: Record<string, unknown>) => void = () => undefined;
    sidecars.upload.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      })
    );
    render();
    share({ json: JSON.stringify({ notes: 'x'.repeat(50_000) }) });
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    render();
    share({ json: '"newer"' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sendEvent).not.toHaveBeenCalled();
    await act(async () => {
      finishUpload({ msgtype: 'm.file', 'm.relates_to': reference });
    });
    expect(sent().map(({ content }) => content.json ?? content.msgtype)).toEqual([
      'm.file',
      '"newer"',
    ]);
  });

  it('shares what is waiting when the tab is hidden, since a closing tab never unmounts', async () => {
    render();
    share({ json: '1' });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    expect(sent().map(({ content }) => content.json)).toEqual(['1']);
  });

  it('discards the unsent local echo of a failed copy', async () => {
    const echo = { status: 'not_sent' };
    const cancelPendingEvent = vi.fn();
    const failing = {
      sendEvent: vi.fn().mockRejectedValue(new Error('offline')),
      makeTxnId: () => 'txn-1',
      cancelPendingEvent,
    } as unknown as MatrixClient;
    const echoRoom = {
      roomId: '!room:example.org',
      getEventForTxnId: (txnId: string) => (txnId === 'txn-1' ? echo : undefined),
    } as unknown as Room;
    let shareFailing: (saved: CanvasSaved) => void = () => undefined;
    function Failing() {
      shareFailing = useCanvasStateShare(failing, echoRoom, '$canvas', true);
      return null;
    }
    act(() => {
      root.render(<Failing />);
    });
    shareFailing({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(cancelPendingEvent).toHaveBeenCalledWith(echo);
  });

  it('shares the same state again after a failed send', async () => {
    sendEvent.mockRejectedValueOnce(new Error('offline'));
    render();
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    share({ json: '1' });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });
});
