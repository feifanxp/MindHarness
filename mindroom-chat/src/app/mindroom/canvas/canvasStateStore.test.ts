import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCanvasStateDbName,
  loadCanvasState,
  MAX_STORED_CANVAS_STATES,
  saveCanvasState,
} from './canvasStateStore';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('canvasStateStore', () => {
  it('keeps one saved state per canvas and session', async () => {
    expect((await loadCanvasState('session-a', '$canvas'))?.json).toBeUndefined();
    await saveCanvasState('session-a', '$canvas', { json: '{"slots":[1,2]}' });
    await saveCanvasState('session-a', '$canvas', { json: '{"slots":[3]}' });
    await saveCanvasState('session-a', '$other', { json: '"other"' });
    expect((await loadCanvasState('session-a', '$canvas'))?.json).toBe('{"slots":[3]}');
    expect((await loadCanvasState('session-a', '$other'))?.json).toBe('"other"');
    expect((await loadCanvasState('session-b', '$canvas'))?.json).toBeUndefined();
  });

  it("keeps a canvas's page state and control values together", async () => {
    await saveCanvasState('session-a', '$canvas', {
      json: '{"slots":[1]}',
      inputs: '{"#rate":"7"}',
    });
    expect(await loadCanvasState('session-a', '$canvas')).toEqual({
      json: '{"slots":[1]}',
      inputs: '{"#rate":"7"}',
    });
  });

  it('forgets the canvases saved longest ago beyond its limit', async () => {
    for (let index = 0; index <= MAX_STORED_CANVAS_STATES; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveCanvasState('session-a', `$canvas-${index}`, { json: `${index}` });
    }
    expect((await loadCanvasState('session-a', '$canvas-0'))?.json).toBeUndefined();
    expect((await loadCanvasState('session-a', '$canvas-1'))?.json).toBe('1');
    expect((await loadCanvasState('session-a', `$canvas-${MAX_STORED_CANVAS_STATES}`))?.json).toBe(
      `${MAX_STORED_CANVAS_STATES}`
    );
  });

  it('forgets the oldest canvas even after the clock went back', async () => {
    const now = vi.spyOn(Date, 'now');
    for (let index = 0; index < MAX_STORED_CANVAS_STATES; index += 1) {
      now.mockReturnValue(1_000 + index);
      // eslint-disable-next-line no-await-in-loop
      await saveCanvasState('session-a', `$canvas-${index}`, { json: `${index}` });
    }
    now.mockReturnValue(1);
    await saveCanvasState('session-a', '$late', { json: '"late"' });
    now.mockRestore();
    expect((await loadCanvasState('session-a', '$late'))?.json).toBe('"late"');
    expect((await loadCanvasState('session-a', '$canvas-0'))?.json).toBeUndefined();
    expect((await loadCanvasState('session-a', '$canvas-1'))?.json).toBe('1');
  });

  it('reports a failed write once and keeps the state saved before it', async () => {
    await saveCanvasState('session-a', '$canvas', { json: '"before"' });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { put } = IDBObjectStore.prototype;
    const failedPut = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function abortedPut(this: IDBObjectStore, ...args) {
        const request = put.apply(this, args);
        this.transaction.abort();
        return request;
      });
    await expect(saveCanvasState('session-a', '$canvas', { json: '"after"' })).rejects.toThrow();
    failedPut.mockRestore();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect((await loadCanvasState('session-a', '$canvas'))?.json).toBe('"before"');
  });

  it('names one database per session, so logout can delete it', () => {
    expect(getCanvasStateDbName('session-a')).toBe('mindroom-canvas-state::session-a');
  });
});
