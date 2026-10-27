// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  createClient,
  EventStatus,
  MatrixError,
  MatrixEvent,
  PendingEventOrdering,
  Room,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CANVAS_SEND_ARM_DELAY_MS, CanvasPanel, type CanvasPanelProps } from './CanvasPanel';
import { CANVAS_RESPONSE_KEY } from './canvasMessages';
import { CANVAS_LIBRARY_SOURCE, canvasPolicy, type CanvasSaved } from './canvasDocument';
import { FALLBACK_CANVAS_THEMES } from './canvasTheme';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not run the wrapper document, so each panel frame gets a stand-in canvas window.
const canvasWindows = vi.hoisted(() => new WeakMap<object, object>());
vi.mock('./canvasDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canvasDocument')>();
  return {
    ...actual,
    canvasFrameWindow: (panelFrame: HTMLIFrameElement | null) => {
      if (!panelFrame) return undefined;
      if (!canvasWindows.has(panelFrame)) canvasWindows.set(panelFrame, {});
      return canvasWindows.get(panelFrame);
    },
  };
});

vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    fill: _fill,
    variant: _variant,
    size: _size,
    outlined: _outlined,
    radii: _radii,
    ...props
  }: React.ComponentProps<'button'> & {
    fill?: string;
    variant?: string;
    size?: string;
    outlined?: boolean;
    radii?: string;
  }) => <button {...props}>{children}</button>,
  Chip: ({
    children,
    as: _as,
    variant: _variant,
    radii: _radii,
    outlined: _outlined,
    ...props
  }: React.ComponentProps<'button'> & {
    as?: string;
    variant?: string;
    radii?: string;
    outlined?: boolean;
  }) => <button {...props}>{children}</button>,
  color: { Critical: { Main: 'red' } },
  Icon: () => <span />,
  IconButton: React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
    ({ children, ...props }, ref) => (
      <button {...props} ref={ref}>
        {children}
      </button>
    )
  ),
  Icons: { Cross: 'Cross', Category: 'Category' },
  // Icon buttons name themselves in tooltips; render only the trigger.
  Tooltip: () => null,
  TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
    children(() => undefined),
  Text: ({
    children,
    className,
    role,
  }: {
    children?: React.ReactNode;
    className?: string;
    role?: string;
  }) => (
    <span className={className} role={role}>
      {children}
    </span>
  ),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('./CanvasPanel.css.ts', () => ({
  Panel: 'Panel',
  Header: 'Header',
  TitleGroup: 'TitleGroup',
  Controls: 'Controls',
  Title: 'Title',
  Frame: 'Frame',
  Footer: 'Footer',
  Error: 'Error',
  Notice: 'Notice',
  Staged: 'Staged',
  Data: 'Data',
  Version: 'Version',
}));

const AGENT = '@mindroom_planner:example.org';
const ME = '@alice:example.org';
const canvas = {
  eventId: '$canvas',
  revisionEventId: '$canvas',
  agentUserId: AGENT,
  threadId: '$thread',
  title: 'Choose a plan',
  html: '<button>Pro</button>',
};

let container: HTMLDivElement;
let root: Root;
// A real SDK client and room: the local echo, scheduler, and status changes are the SDK's own.
let mx: MatrixClient;
let room: Room;
let sendMessage: MockInstance;
// Each send waits here until a test answers it, as a homeserver would.
let requests: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>;

const render = (props: Partial<CanvasPanelProps> = {}) =>
  act(() => {
    root.render(
      <MatrixClientProvider value={mx}>
        <CanvasPanel
          mx={mx}
          room={room}
          canvas={canvas}
          agentName="Planner"
          colorScheme="dark"
          theme={{ ...FALLBACK_CANVAS_THEMES.dark, accent: '#123456' }}
          onClose={() => undefined}
          {...props}
        />
      </MatrixClientProvider>
    );
  });

const frame = () => container.querySelector('iframe') as HTMLIFrameElement;
const button = (selector: string) => container.querySelector(selector) as HTMLButtonElement;
const buttonNamed = (name: string) =>
  [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === name) as
    | HTMLButtonElement
    | undefined;
const canvasWindow = () => {
  if (!canvasWindows.has(frame())) canvasWindows.set(frame(), {});
  return canvasWindows.get(frame());
};
/** The canvas page, which the wrapper document carries as a script string. */
const page = () => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(frame().getAttribute('srcdoc') ?? '');
  return literal ? (JSON.parse(literal[1]) as string) : '';
};
/** The local echo of the last answer, held before the SDK forgets its transaction ID. */
const lastEcho = (): MatrixEvent => {
  const txnId = sendMessage.mock.calls.at(-1)?.[2] as string;
  return room.getEventForTxnId(txnId) as MatrixEvent;
};
const status = () => container.querySelector('[data-canvas-status]')?.textContent ?? '';

const post = async (data: unknown, source: unknown = canvasWindow()) => {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'null', source: source as Window })
    );
  });
};

const submit = (label = 'Pro plan', data: unknown = { plan: 'pro' }) => ({
  type: 'mindroom.canvas.submit',
  version: 1,
  data,
  label,
});

const arm = () =>
  act(async () => {
    vi.advanceTimersByTime(CANVAS_SEND_ARM_DELAY_MS);
  });

const clickSend = () =>
  act(async () => {
    button('[data-canvas-send]').click();
  });

/** The homeserver accepts the oldest waiting send. */
const accept = () =>
  act(async () => {
    requests.shift()?.resolve({ event_id: '$response' });
  });

/** The homeserver refuses the oldest waiting send; the SDK does not retry a 403. */
const refuse = () =>
  act(async () => {
    requests.shift()?.reject(new MatrixError({ errcode: 'M_FORBIDDEN', error: 'No' }, 403));
  });

const touchFrame = () =>
  act(async () => {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => frame() });
    window.dispatchEvent(new Event('blur'));
    delete (document as { activeElement?: unknown }).activeElement;
  });

const reportError = (text: string, source?: unknown) =>
  post({ type: 'mindroom.canvas.error', version: 1, message: text }, source);
const reportButton = () => button('[data-canvas-report]');

const answer = async (label = 'Pro plan') => {
  await post(submit(label));
  await arm();
  await clickSend();
};

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  room = new Room('!room:example.org', mx, ME, {
    pendingEventOrdering: PendingEventOrdering.Chronological,
  });
  mx.store.storeRoom(room);
  requests = [];
  vi.spyOn(mx.http, 'authedRequest').mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject });
      }) as never
  );
  sendMessage = vi.spyOn(mx, 'sendMessage');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mx.stopClient();
  vi.useRealTimers();
});

describe('CanvasPanel', () => {
  it('renders agent HTML in an opaque-origin sandbox with provenance and disclosure', () => {
    render();
    const iframe = frame();
    // The panel frame holds a wrapper whose policy keeps the canvas frame from navigating.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('allow')).toContain("camera 'none'");
    expect(iframe.getAttribute('srcdoc')).toContain("frame-src 'none'");
    expect(iframe.getAttribute('srcdoc')).toContain(
      "setAttribute('sandbox', 'allow-scripts allow-forms')"
    );
    expect(page()).toContain('<button>Pro</button>');
    expect(page()).toContain('content="dark"');
    expect(container.textContent).toContain('Choose a plan');
    expect(container.textContent).toContain('Interactive panel from Planner');
    expect(container.textContent).toContain('what you enter here may leave this panel');
  });

  it('tells the user, whatever else the footer shows, when the room can read what they enter', () => {
    render({ shared: true });
    expect(container.textContent).toContain(
      'Saved in this room: Planner and others here can read what you enter.'
    );
    expect(container.textContent).toContain('what you enter here may leave this panel');
  });

  it("says whether a save follows the user's work in the page", async () => {
    const onSaveState = vi.fn();
    render({ onSaveState });
    // Saved as the page loads: the user has not worked in it.
    await post({ type: 'mindroom.canvas.state', version: 1, json: '{"defaults":true}' });
    const focused = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frame());
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    focused.mockRestore();
    // Saved after the user worked in it, even once focus has moved on.
    await post({ type: 'mindroom.canvas.state', version: 1, json: '{"done":["tent"]}' });
    // Where the browser can tell, its user activation wins: a page's own focus() is not the user.
    await post({
      type: 'mindroom.canvas.state',
      version: 1,
      json: '{"focused":true}',
      user: false,
    });
    expect(onSaveState.mock.calls).toEqual([
      [{ json: '{"defaults":true}' }, false],
      [{ json: '{"done":["tent"]}' }, true],
      [{ json: '{"focused":true}' }, false],
    ]);
  });

  it('lets the page load libraries only when the deployment turns them on', () => {
    render();
    expect(frame().getAttribute('srcdoc')).not.toContain(CANVAS_LIBRARY_SOURCE);
    render({ libraries: true });
    expect(page()).toContain(`content="${canvasPolicy(true)}"`);
  });

  it('stages a canvas submission until the user sends it from the host', async () => {
    render();
    await post(submit());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Send to Planner: Pro plan');
    expect(container.textContent).toContain('"plan": "pro"');
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await arm();
    await clickSend();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [roomId, content] = sendMessage.mock.calls[0];
    expect(roomId).toBe('!room:example.org');
    expect(content[CANVAS_RESPONSE_KEY]).toMatchObject({
      canvas_event_id: '$canvas',
      canvas_revision_event_id: '$canvas',
      label: 'Pro plan',
      data: { plan: 'pro' },
    });
    // The snapshot is handed to the SDK: the panel shows the message's status, not a copy.
    expect(button('[data-canvas-send]')).toBeNull();
    expect(status()).toContain('Sending to Planner');
    await accept();
    expect(status()).toContain('Sent to Planner: Pro plan');
  });

  it('keeps the pending snapshot until the user sends or discards it', async () => {
    // Even right after a real click, a canvas cannot swap what the user is reviewing.
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true, hasBeenActive: true },
    });
    render();
    await post(submit('Basic', { plan: 'basic' }));
    // How to change an answer is said only once the page tries to change it.
    expect(container.textContent).not.toContain('discard this one first');
    await arm();
    // The same answer again (a double click) changes nothing the user needs to hear about.
    await post(submit('Basic', { plan: 'basic' }));
    expect(container.textContent).not.toContain('discard this one first');
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('Everything', { plan: 'everything' }));
    expect(container.textContent).toContain('Send to Planner: Basic');
    expect(container.textContent).toContain('To change your answer, discard this one first.');
    expect(button('[data-canvas-send]').disabled).toBe(false);
    await act(async () => button('[data-canvas-discard]').click());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('Pro plan'));
    expect(container.textContent).not.toContain('discard this one first');
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await clickSend();
    expect(sendMessage).not.toHaveBeenCalled();
    await arm();
    await clickSend();
    expect(sendMessage.mock.calls[0][1][CANVAS_RESPONSE_KEY].label).toBe('Pro plan');
    delete (navigator as { userActivation?: unknown }).userActivation;
  });

  it('bounds how fast a canvas can stage snapshots', async () => {
    render();
    await post(submit('one'));
    await act(async () => button('[data-canvas-discard]').click());
    await post(submit('two'));
    expect(button('[data-canvas-send]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('three'));
    expect(container.textContent).toContain('Send to Planner: three');
  });

  it('discards a staged snapshot', async () => {
    render();
    await post(submit());
    await act(async () => button('[data-canvas-discard]').click());
    expect(button('[data-canvas-send]')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages from other windows', async () => {
    render();
    await post(submit(), window);
    expect(button('[data-canvas-send]')).toBeNull();
  });

  it('counts an answer as sent once the server accepts it, and after its copy arrives', async () => {
    render();
    await answer();
    const echo = lastEcho();
    await accept();
    expect(echo.status).toBe(EventStatus.SENT);
    expect(status()).toContain('Sent to Planner: Pro plan');
    // The copy from /sync replaces the echo, and the SDK forgets the transaction ID.
    await act(async () => {
      room.handleRemoteEcho(
        new MatrixEvent({
          event_id: '$response',
          room_id: room.roomId,
          sender: ME,
          type: 'm.room.message',
          origin_server_ts: 1,
          content: echo.getContent(),
          unsigned: { transaction_id: sendMessage.mock.calls[0][2] as string },
        }),
        echo
      );
    });
    expect(echo.status).toBeNull();
    expect(room.getEventForTxnId(sendMessage.mock.calls[0][2] as string)).toBeUndefined();
    expect(status()).toContain('Sent to Planner: Pro plan');
  });

  it("offers the timeline's Retry and Delete for a failed answer, naming it", async () => {
    render();
    await answer();
    await refuse();
    expect(lastEcho().status).toBe(EventStatus.NOT_SENT);
    expect(status()).toContain('Not sent to Planner: Pro plan');
    await act(async () => buttonNamed('Retry')?.click());
    expect(status()).toContain('Sending to Planner');
    expect(requests).toHaveLength(1);
    await accept();
    expect(status()).toContain('Sent to Planner: Pro plan');
  });

  it('returns to the disclosure when a failed answer is deleted', async () => {
    render();
    await answer();
    await refuse();
    await act(async () => buttonNamed('Delete')?.click());
    expect(lastEcho().status).toBe(EventStatus.CANCELLED);
    expect(status()).toContain('what you enter here may leave this panel');
  });

  it('shows a retry or deletion started from the timeline', async () => {
    render();
    await answer();
    await refuse();
    const echo = lastEcho();
    await act(async () => {
      mx.resendEvent(echo, room).catch(() => undefined);
    });
    expect(status()).toContain('Sending to Planner');
    await refuse();
    expect(status()).toContain('Not sent to Planner');
    await act(async () => mx.cancelPendingEvent(echo));
    expect(status()).toContain('what you enter here may leave this panel');
  });

  it('shows a failure the server returns at once', async () => {
    vi.mocked(mx.http.authedRequest).mockImplementationOnce(() =>
      Promise.reject(new MatrixError({ errcode: 'M_FORBIDDEN', error: 'No' }, 403))
    );
    render();
    await answer();
    expect(status()).toContain('Not sent to Planner: Pro plan');
  });

  it('holds one unresolved answer at a time', async () => {
    render();
    await answer('one');
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('two'));
    await arm();
    // The first answer is still sending, so the second cannot be sent yet.
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await refuse();
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await act(async () => buttonNamed('Delete')?.click());
    expect(button('[data-canvas-send]').disabled).toBe(false);
    await clickSend();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await accept();
    expect(status()).toContain('Sent to Planner: two');
    // A sent answer leaves the panel free for the next one on the same page.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('three'));
    await arm();
    expect(button('[data-canvas-send]').disabled).toBe(false);
  });

  it("keeps a failed answer's Retry and Delete across a new page", async () => {
    render();
    await answer();
    // The next step loads at once (nothing unsent in the frame), then the answer fails.
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<p>Step 2</p>');
    await refuse();
    expect(status()).toContain('Not sent to Planner: Pro plan');
    expect(buttonNamed('Retry')).toBeDefined();
    // A sent answer does not follow the panel to the next page.
    await act(async () => buttonNamed('Retry')?.click());
    await accept();
    render({ canvas: { ...canvas, revisionEventId: '$edit-2', html: '<p>Step 3</p>' } });
    expect(status()).toContain('what you enter here may leave this panel');
  });

  it('keeps the status and drops only the snapshot when an update waits', async () => {
    render();
    await answer();
    await refuse();
    await touchFrame();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(submit('Basic'));
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(button('[data-canvas-send]')).toBeNull();
    expect(status()).toContain('Not sent to Planner: Pro plan');
  });

  it('uploads an answer too large for one event and sends a preview that points at it', async () => {
    let finishUpload: () => void = () => undefined;
    const uploadContent = vi.spyOn(mx, 'uploadContent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve({ content_uri: 'mxc://example.org/answer' });
        }) as never
    );
    render();
    await post(submit('Edited draft', { text: 'A long paragraph. '.repeat(4000) }));
    await arm();
    await clickSend();
    expect(uploadContent).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(status()).toContain('Sending to Planner');
    expect(button('[data-canvas-send]').disabled).toBe(true);
    await act(async () => finishUpload());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const preview = sendMessage.mock.calls[0][1];
    expect(preview).toMatchObject({
      msgtype: 'm.file',
      url: 'mxc://example.org/answer',
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      [CANVAS_RESPONSE_KEY]: { canvas_event_id: '$canvas', label: 'Edited draft' },
    });
    expect(preview[CANVAS_RESPONSE_KEY].data).toBeUndefined();
    expect(button('[data-canvas-send]')).toBeNull();
    await accept();
    expect(status()).toContain('Sent to Planner: Edited draft');
  });

  const slowUpload = () => {
    const uploads: Array<{ finish: () => void; fail: () => void }> = [];
    vi.spyOn(mx, 'uploadContent').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          uploads.push({
            finish: () => resolve({ content_uri: 'mxc://example.org/answer' }),
            fail: () => reject(new Error('offline')),
          });
        }) as never
    );
    return uploads;
  };
  const update = () =>
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
  const largeAnswer = (label: string) =>
    submit(label, { text: `${label}: ${'A long paragraph. '.repeat(4000)}` });

  it('cancels a large answer discarded during its upload and keeps a newer one', async () => {
    const uploads = slowUpload();
    render();
    await post(largeAnswer('First'));
    await arm();
    await clickSend();
    await act(async () => button('[data-canvas-discard]').click());
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await post(largeAnswer('Second'));
    await act(async () => uploads[0].finish());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Send to Planner: Second');
    expect(button('[data-canvas-send]')).not.toBeNull();
  });

  it('holds a new page behind Load update while a large answer uploads, then sends it', async () => {
    const uploads = slowUpload();
    render();
    await post(largeAnswer('First'));
    await arm();
    await clickSend();
    // Until the answer is sent, the page holds the user's work, so the update waits for them.
    update();
    expect(page()).toContain('<button>Pro</button>');
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(container.textContent).toContain('Send to Planner: First');
    await act(async () => uploads[0].finish());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1][CANVAS_RESPONSE_KEY].label).toBe('First');
    expect(button('[data-canvas-send]')).toBeNull();
    await act(async () => buttonNamed('Load update')?.click());
    expect(page()).toContain('<p>Step 2</p>');
  });

  it('keeps a large answer for another try when its upload fails after an update arrived', async () => {
    const uploads = slowUpload();
    render();
    await post(largeAnswer('First'));
    await arm();
    await clickSend();
    update();
    await act(async () => uploads[0].fail());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(status()).toContain('Could not send your response');
    expect(page()).toContain('<button>Pro</button>');
    expect(container.textContent).toContain('Send to Planner: First');
    expect(button('[data-canvas-send]').disabled).toBe(false);
  });

  it('still sends a large answer when the user loads a new page and discards an answer there', async () => {
    const uploads = slowUpload();
    render();
    await post(largeAnswer('First'));
    await arm();
    await clickSend();
    update();
    await act(async () => buttonNamed('Load update')?.click());
    expect(page()).toContain('<p>Step 2</p>');
    // The user committed the first answer; discarding one on the new page leaves it alone.
    await post(largeAnswer('Second'));
    await act(async () => button('[data-canvas-discard]').click());
    await act(async () => uploads[0].finish());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1][CANVAS_RESPONSE_KEY].label).toBe('First');
  });

  it('keeps a large answer for another try when its upload fails', async () => {
    vi.spyOn(mx, 'uploadContent').mockRejectedValue(new Error('offline'));
    render();
    await post(submit('Edited draft', { text: 'A long paragraph. '.repeat(4000) }));
    await arm();
    await clickSend();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(status()).toContain('Could not send your response');
    expect(container.textContent).toContain('Send to Planner: Edited draft');
    expect(button('[data-canvas-send]').disabled).toBe(false);
  });

  it('reports a refused send rather than the previous answer', async () => {
    render();
    await answer('one');
    await accept();
    sendMessage.mockImplementationOnce(() => {
      throw new Error('Room is not known');
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await answer('two');
    expect(status()).toContain('Could not send your response');
    expect(status()).not.toContain('Sent to Planner: one');
    expect(container.textContent).toContain('Send to Planner: two');
  });

  it('keeps the snapshot when the SDK refuses the send outright', async () => {
    sendMessage.mockImplementationOnce(() => {
      throw new Error('Room is not known');
    });
    render();
    await answer();
    expect(container.textContent).toContain('Send to Planner: Pro plan');
    expect(status()).toContain('Could not send your response');
    expect(button('[data-canvas-send]').disabled).toBe(false);
  });

  it('accepts the first answer of a new revision right after the previous one', async () => {
    render();
    await answer('one');
    await accept();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    await post(submit('two'));
    expect(container.textContent).toContain('Send to Planner: two');
  });

  it('keeps the page when the theme changes', async () => {
    render();
    const first = frame();
    render({ colorScheme: 'light' });
    expect(frame()).toBe(first);
  });

  it('keeps an answer staged while an update waits for the user', async () => {
    render();
    await touchFrame();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Planner updated this panel.');
    await post(submit());
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(container.textContent).toContain('Send to Planner: Pro plan');
  });

  it('offers to tell the agent about errors the page reports', async () => {
    render();
    expect(reportButton()).toBeNull();
    await reportError('TypeError: boom');
    await reportError('TypeError: boom');
    await reportError('Blocked https://cdn.example/x.js (script-src-elem)');
    expect(container.textContent).toContain('This page reported an error.');
    expect(container.textContent).toContain('TypeError: boom');
    await act(async () => reportButton().click());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((sendMessage.mock.calls[0][1] as { body: string }).body).toBe(
      `${AGENT} Canvas error ($canvas, revision $canvas):\nTypeError: boom\nBlocked https://cdn.example/x.js (script-src-elem)`
    );
    expect(reportButton()).toBeNull();
    expect(container.textContent).toContain('Sending to Planner');
    await accept();
    expect(container.textContent).toContain('Sent the errors to Planner.');
    // A new error after the report can be sent too; one already sent is not offered again.
    await reportError('TypeError: boom');
    expect(reportButton()).toBeNull();
    await reportError('RangeError: later');
    await act(async () => reportButton().click());
    expect((sendMessage.mock.calls[1][1] as { body: string }).body).toBe(
      `${AGENT} Canvas error ($canvas, revision $canvas):\nRangeError: later`
    );
  });

  it('says when a report could not be sent, and offers it again once deleted', async () => {
    render();
    await reportError('TypeError: boom');
    await act(async () => reportButton().click());
    await refuse();
    expect(container.textContent).toContain('Could not send the errors to Planner.');
    expect(container.textContent).not.toContain('Sent the errors');
    // A new error is kept while the report is unresolved; its Retry and Delete stay, Tell waits.
    await reportError('RangeError: later');
    expect(container.textContent).toContain('Could not send the errors to Planner.');
    expect(container.textContent).toContain('RangeError: later');
    expect(reportButton().disabled).toBe(true);
    await act(async () => buttonNamed('Delete')?.click());
    expect(container.textContent).not.toContain('Could not send');
    expect(container.textContent).toContain('TypeError: boom\nRangeError: later');
    expect(reportButton().disabled).toBe(false);
  });

  it('keeps at most five errors, counting a report that is not sent yet', async () => {
    render();
    for (const index of [1, 2, 3, 4, 5]) await reportError(`Error ${index}`);
    await act(async () => reportButton().click());
    await reportError('Error 6');
    expect(container.textContent).not.toContain('Error 6');
    await refuse();
    await act(async () => buttonNamed('Delete')?.click());
    expect(container.querySelector('pre')?.textContent?.split('\n')).toHaveLength(5);
  });

  it('keeps an error that arrives while a report is sending, for the next report', async () => {
    render();
    await reportError('TypeError: first');
    await act(async () => reportButton().click());
    await reportError('TypeError: second');
    expect(reportButton().disabled).toBe(true);
    await accept();
    expect(container.textContent).toContain('Sent the errors to Planner.');
    await act(async () => reportButton().click());
    expect((sendMessage.mock.calls[1][1] as { body: string }).body).toBe(
      `${AGENT} Canvas error ($canvas, revision $canvas):\nTypeError: second`
    );
  });

  it('takes error reports only from the canvas, keeps five, and forgets them on a new page', async () => {
    render();
    await reportError('from elsewhere', {});
    expect(reportButton()).toBeNull();
    for (const index of [1, 2, 3, 4, 5, 6]) await reportError(`Error ${index}`);
    expect(container.textContent).toContain('Error 5');
    expect(container.textContent).not.toContain('Error 6');
    // An error the full list dropped was never shown, so it can still be offered after a report.
    await act(async () => reportButton().click());
    await accept();
    await reportError('Error 6');
    expect(container.textContent).toContain('Error 6');
    expect(reportButton()).not.toBeNull();
    // Error reports are not answers, so they neither stage an answer nor hold back an update.
    expect(button('[data-canvas-send]')).toBeNull();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<p>Step 2</p>');
    expect(reportButton()).toBeNull();
  });

  it('switches versions from the header, but not while an answer waits', async () => {
    const onSelectVersion = vi.fn();
    render({ version: { current: 2, total: 3 }, onSelectVersion });
    expect(container.textContent).toContain('Version 2 of 3');
    expect(container.textContent).toContain('This is an earlier version.');
    await act(async () => button('[aria-label="Previous version"]').click());
    expect(onSelectVersion).toHaveBeenLastCalledWith(1);
    await act(async () => button('[aria-label="Next version"]').click());
    expect(onSelectVersion).toHaveBeenLastCalledWith(3);
    await act(async () => buttonNamed('Show latest')?.click());
    expect(onSelectVersion).toHaveBeenLastCalledWith(3);
    await post(submit());
    expect(button('[aria-label="Previous version"]').disabled).toBe(true);
    expect(buttonNamed('Show latest')?.disabled).toBe(true);
    render({ version: { current: 3, total: 3 }, onSelectVersion });
    expect(container.textContent).not.toContain('earlier version');
    render();
    expect(button('[aria-label="Previous version"]')).toBeNull();
  });

  it('hides the version switcher while an update waits behind Load update', async () => {
    const latest = { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' };
    const onSelectVersion = vi.fn();
    render({ canvas: latest, version: { current: 2, total: 2 }, onSelectVersion });
    await touchFrame();
    const next = { ...canvas, revisionEventId: '$edit-3', html: '<p>Step 3</p>' };
    render({ canvas: next, version: { current: 3, total: 3 }, onSelectVersion });
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(container.textContent).not.toContain('Version 3 of 3');
    expect(button('[aria-label="Previous version"]')).toBeNull();
    await act(async () => buttonNamed('Load update')?.click());
    expect(page()).toContain('<p>Step 3</p>');
    expect(container.textContent).toContain('Version 3 of 3');
  });

  it('loads the version the user picks at once, even after they worked in the page', async () => {
    const latest = { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' };
    render({ canvas: latest, version: { current: 2, total: 2 }, onSelectVersion: () => undefined });
    await touchFrame();
    await act(async () => button('[aria-label="Previous version"]').click());
    render({ canvas, version: { current: 1, total: 2 }, onSelectVersion: () => undefined });
    expect(page()).toContain('<button>Pro</button>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('starts each page from the saved state and saves what the page sends without reloading', async () => {
    let saved: CanvasSaved = { json: '{"slots":[1]}' };
    const onSaveState = vi.fn((change: CanvasSaved) => {
      saved = { ...saved, ...change };
    });
    const stateIn = (json: string) => `state: JSON.parse(${JSON.stringify(json)})`;
    // One theme throughout, so only the revision tells the panel to build a new page.
    const theme = { ...FALLBACK_CANVAS_THEMES.dark, accent: '#123456' };
    render({ savedState: () => saved, onSaveState, theme });
    expect(page()).toContain(stateIn('{"slots":[1]}'));
    const first = frame();
    await post({ type: 'mindroom.canvas.state', version: 1, json: '{"slots":[1,2]}' });
    await post({ type: 'mindroom.canvas.state', version: 1, json: '{"slots":[1,2,3]}' }, {});
    await post({ type: 'mindroom.canvas.state', version: 1, inputs: '{"#rate":"7"}' });
    expect(onSaveState.mock.calls).toEqual([
      [{ json: '{"slots":[1,2]}' }, false],
      [{ inputs: '{"#rate":"7"}' }, false],
    ]);
    expect(frame()).toBe(first);
    // Saving is not an answer, so the next page still loads at once, starting from that state.
    render({
      canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' },
      savedState: () => saved,
      onSaveState,
      theme,
    });
    expect(page()).toContain('<p>Step 2</p>');
    expect(page()).toContain(stateIn('{"slots":[1,2]}'));
    // A revision with the same page gets a new frame, which starts from the latest state too.
    await post({ type: 'mindroom.canvas.state', version: 1, json: '{"slots":[4]}' });
    render({
      canvas: { ...canvas, revisionEventId: '$edit2', html: '<p>Step 2</p>' },
      savedState: () => saved,
      onSaveState,
      theme,
    });
    expect(page()).toContain(stateIn('{"slots":[4]}'));
  });

  it('stops a canvas that navigates away from its document', async () => {
    render();
    await act(async () => {
      frame().dispatchEvent(new Event('load'));
      frame().dispatchEvent(new Event('load'));
    });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('tried to leave');
    await act(async () => button('[data-canvas-reload]').click());
    expect(frame()).not.toBeNull();
  });

  it('stops a canvas whose wrapper reports that it navigated', async () => {
    render();
    await post({ type: 'mindroom.canvas.escaped' });
    expect(frame()).not.toBeNull();
    await post({ type: 'mindroom.canvas.escaped' }, frame().contentWindow);
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('tried to leave');
  });

  it('loads an update at once when the user has not worked in the panel', async () => {
    render();
    const first = frame();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(frame()).not.toBe(first);
    expect(page()).toContain('<p>Step 2</p>');
  });

  it('loads the next step at once after the user answered the current one', async () => {
    render();
    await touchFrame();
    await post(submit());
    await arm();
    await clickSend();
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<p>Step 2</p>');
  });

  it('asks before an update replaces unsent work', async () => {
    render();
    await touchFrame();
    await post(submit());
    render({ canvas: { ...canvas, revisionEventId: '$edit', html: '<p>Step 2</p>' } });
    expect(page()).toContain('<button>Pro</button>');
    expect(container.textContent).toContain('Planner updated this panel.');
    expect(button('[data-canvas-send]')).toBeNull();
    const load = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Load update')
    ) as HTMLButtonElement;
    await act(async () => load.click());
    expect(page()).toContain('<p>Step 2</p>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('gives the page the Chat theme as CSS variables', () => {
    render();
    expect(page()).toContain('--mr-accent:#123456');
  });

  it('shows a page that is still downloading, then the page itself', async () => {
    render({ canvas: { ...canvas, html: '', status: 'loading' } });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('Loading panel');
    render({ canvas: { ...canvas, html: '<p>Downloaded</p>' } });
    expect(page()).toContain('<p>Downloaded</p>');
  });

  it('explains a page that could not be loaded and offers a retry', () => {
    const onRetry = vi.fn();
    render({ canvas: { ...canvas, html: '', status: 'failed' }, onRetry });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain('could not be loaded');
    const retry = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Retry'
    ) as HTMLButtonElement;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a downloaded page at once even after the user focused the panel', async () => {
    render({ canvas: { ...canvas, html: '', status: 'loading' } });
    await touchFrame();
    render({ canvas: { ...canvas, html: '<p>Downloaded</p>' } });
    expect(page()).toContain('<p>Downloaded</p>');
    expect(container.textContent).not.toContain('updated this panel');
  });

  it('offers expanding the panel where the room allows it', () => {
    const onToggleExpanded = vi.fn();
    render({ onToggleExpanded });
    act(() => button('[aria-label="Expand canvas"]').click());
    expect(onToggleExpanded).toHaveBeenCalled();
    expect(button('[aria-label="Expand canvas"]').getAttribute('aria-pressed')).toBe('false');
    render({ onToggleExpanded, expanded: true });
    expect(button('[aria-label="Expand canvas"]').getAttribute('aria-pressed')).toBe('true');
    render({ onToggleExpanded: undefined });
    expect(button('[aria-label="Expand canvas"]')).toBeNull();
  });

  it('closes', () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => button('[aria-label="Close canvas"]').click());
    expect(onClose).toHaveBeenCalled();
  });
});
