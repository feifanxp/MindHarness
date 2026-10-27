// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId, putSession, removeSession } from '../../state/sessions';
import { loadCanvasState, saveCanvasState } from './canvasStateStore';
import { type CanvasSavedState, useCanvasSavedState } from './useCanvasSavedState';

vi.mock('./canvasStateStore', async (importOriginal) => {
  const store = await importOriginal<typeof import('./canvasStateStore')>();
  return { ...store, saveCanvasState: vi.fn(store.saveCanvasState) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mx = {
  getHomeserverUrl: () => 'https://example.org',
  getSafeUserId: () => '@alice:example.org',
} as unknown as MatrixClient;
const sessionId = createSessionId('https://example.org', '@alice:example.org');

let container: HTMLDivElement;
let root: Root;
let state: CanvasSavedState;

function Probe() {
  state = useCanvasSavedState(mx, '$canvas');
  return null;
}

const render = () =>
  act(() => {
    root.render(<Probe />);
  });

const writes = () => vi.mocked(saveCanvasState).mock.calls.map(([, , saved]) => saved.json);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  putSession({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    deviceId: 'DEVICE',
    accessToken: 'token',
  });
  vi.mocked(saveCanvasState).mockClear();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

describe('useCanvasSavedState', () => {
  it('reads the saved state before the page may start', async () => {
    await saveCanvasState(sessionId, '$canvas', { json: '{"slots":[1]}' });
    render();
    expect(state.ready).toBe(false);
    await vi.waitFor(() => expect(state.ready).toBe(true));
    expect(state.read().json).toBe('{"slots":[1]}');
  });

  it('starts without state when it cannot be read, and keeps saves from overwriting it', async () => {
    await saveCanvasState(sessionId, '$canvas', { json: '{"slots":[1]}' });
    vi.mocked(saveCanvasState).mockClear();
    const open = vi.spyOn(globalThis.indexedDB, 'open').mockImplementationOnce(() => {
      throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
    });
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    open.mockRestore();
    expect(state.read().json).toBeUndefined();
    act(() => state.save({ json: '{"slots":[]}' }));
    expect(state.read().json).toBe('{"slots":[]}');
    act(() => root.unmount());
    root = createRoot(container);
    expect(writes()).toEqual([]);
    expect((await loadCanvasState(sessionId, '$canvas'))?.json).toBe('{"slots":[1]}');
  });

  it('writes the latest of quick saves once, and on leaving at the latest', async () => {
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    act(() => {
      state.save({ json: '{"draft":"a"}' });
      state.save({ json: '{"draft":"ab"}' });
    });
    expect(state.read().json).toBe('{"draft":"ab"}');
    expect((await loadCanvasState(sessionId, '$canvas'))?.json).toBeUndefined();
    await vi.waitFor(async () =>
      expect((await loadCanvasState(sessionId, '$canvas'))?.json).toBe('{"draft":"ab"}')
    );
    expect(writes()).toEqual(['{"draft":"ab"}']);
    act(() => state.save({ json: '{"draft":"abc"}' }));
    act(() => root.unmount());
    // Leaving writes at once rather than when the save interval ends.
    expect(writes()).toEqual(['{"draft":"ab"}', '{"draft":"abc"}']);
    // Reopened at once, the panel reads after that write, since IndexedDB keeps their order.
    root = createRoot(container);
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    expect(state.read().json).toBe('{"draft":"abc"}');
  });

  it('writes the page state and the control values as one', async () => {
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    act(() => {
      state.save({ json: '{"slots":[1]}' });
      state.save({ inputs: '{"#rate":"7"}' });
    });
    act(() => root.unmount());
    root = createRoot(container);
    expect(vi.mocked(saveCanvasState).mock.calls.map(([, , saved]) => saved)).toEqual([
      { json: '{"slots":[1]}', inputs: '{"#rate":"7"}' },
    ]);
  });

  it('writes nothing once its account is removed, so the deleted state stays deleted', async () => {
    render();
    await vi.waitFor(() => expect(state.ready).toBe(true));
    act(() => state.save({ json: '{"draft":"secret"}' }));
    removeSession(sessionId);
    act(() => root.unmount());
    root = createRoot(container);
    expect(writes()).toEqual([]);
  });
});
