// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerScreen, type RfbClient } from './ComputerScreen';

vi.mock('./ComputerPanel.css.ts', () => ({
  Screen: 'Screen',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listeners = new Map<string, EventListener>();
const rfb: RfbClient = {
  addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
  removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  disconnect: vi.fn(),
  focus: vi.fn(),
  scaleViewport: false,
  viewOnly: true,
};

describe('ComputerScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('owns one scaled noVNC connection and disposes it with its callbacks', () => {
    const createRfb = vi.fn(() => rfb);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="view"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    expect(createRfb).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'wss://computer.example.org/api/computers/sessions/session-1/stream',
      { wsProtocols: ['binary', 'mindroom-ticket.ticket-1'] }
    );
    expect(rfb.scaleViewport).toBe(true);
    expect(rfb.viewOnly).toBe(true);

    act(() => listeners.get('connect')?.(new Event('connect')));
    expect(onConnected).toHaveBeenCalledOnce();

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={createRfb}
          mode="control"
          onConnected={onConnected}
          onDisconnected={onDisconnected}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });
    expect(createRfb).toHaveBeenCalledOnce();
    expect(rfb.viewOnly).toBe(false);

    act(() => root.unmount());
    expect(rfb.disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('keeps keyboard and paste events inside the computer surface', () => {
    const windowKeyDown = vi.fn();
    const windowPaste = vi.fn();
    const rfbKeyDown = vi.fn();
    const rfbPaste = vi.fn();
    window.addEventListener('keydown', windowKeyDown);
    window.addEventListener('paste', windowPaste);

    act(() => {
      root.render(
        <ComputerScreen
          createRfb={(target) => {
            const canvas = document.createElement('canvas');
            canvas.tabIndex = -1;
            canvas.addEventListener('keydown', rfbKeyDown);
            canvas.addEventListener('paste', rfbPaste);
            target.append(canvas);
            return rfb;
          }}
          mode="control"
          onConnected={() => undefined}
          onDisconnected={() => undefined}
          protocols={['binary', 'mindroom-ticket.ticket-1']}
          url="wss://computer.example.org/api/computers/sessions/session-1/stream"
        />
      );
    });

    const surface = container.querySelector<HTMLElement>('[data-mindroom-computer-input]');
    const canvas = surface?.querySelector('canvas');
    expect(surface).not.toBeNull();
    expect(canvas).not.toBeNull();
    canvas?.focus();
    canvas?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA' }));
    canvas?.dispatchEvent(new Event('paste', { bubbles: true }));

    expect(rfbKeyDown).toHaveBeenCalledOnce();
    expect(rfbPaste).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(canvas);
    expect(windowKeyDown).not.toHaveBeenCalled();
    expect(windowPaste).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowKeyDown);
    window.removeEventListener('paste', windowPaste);
  });
});
