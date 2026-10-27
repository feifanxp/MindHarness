import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CanvasListEntry,
  forgetCanvas,
  getCanvasIndexDbName,
  isComputerShown,
  listCanvases,
  recordCanvas,
  recordCanvasUpdate,
  recordComputerShown,
  subscribeCanvasList,
} from './canvasIndexStore';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const AGENT = '@mindroom_planner:example.org';

const entry = (overrides: Partial<CanvasListEntry> = {}): CanvasListEntry => ({
  canvasId: '$canvas',
  roomId: '!room:example.org',
  threadId: '$thread',
  agentUserId: AGENT,
  title: 'Plans',
  revisionId: '$canvas',
  createdTs: 1,
  updatedTs: 1,
  shared: false,
  ...overrides,
});

describe('canvasIndexStore', () => {
  it('lists the canvases of one session', async () => {
    await recordCanvas('session-a', entry());
    await recordCanvas('session-a', entry({ canvasId: '$other', title: 'Other' }));
    expect((await listCanvases('session-a')).map((listed) => listed.title).sort()).toEqual([
      'Other',
      'Plans',
    ]);
    expect(await listCanvases('session-b')).toEqual([]);
  });

  it('never rolls a newer update back to an older copy of the request', async () => {
    await recordCanvas('session-a', entry({ title: 'Plans v2', revisionId: '$v2', updatedTs: 5 }));
    await recordCanvas('session-a', entry({ title: 'Plans', updatedTs: 1, shared: true }));
    expect(await listCanvases('session-a')).toEqual([
      entry({ title: 'Plans v2', revisionId: '$v2', updatedTs: 5, shared: true }),
    ]);
  });

  it('applies an update its check accepts, when it is the newest', async () => {
    await recordCanvas('session-a', entry({ updatedTs: 5 }));
    const check = vi.fn((known: CanvasListEntry) =>
      known.title === 'Plans' ? { title: 'Plans v2', revisionId: '$v2' } : undefined
    );
    await recordCanvasUpdate('session-a', '$canvas', 9, () => undefined);
    await recordCanvasUpdate('session-a', '$canvas', 4, check);
    expect(check).not.toHaveBeenCalled();
    expect((await listCanvases('session-a'))[0]).toMatchObject({ title: 'Plans', updatedTs: 5 });
    await recordCanvasUpdate('session-a', '$canvas', 6, check);
    expect(check).toHaveBeenCalledWith(entry({ updatedTs: 5 }));
    expect((await listCanvases('session-a'))[0]).toMatchObject({
      title: 'Plans v2',
      revisionId: '$v2',
      updatedTs: 6,
    });
    // An update of a canvas not listed has nothing to apply to.
    await recordCanvasUpdate('session-a', '$unknown', 7, () => ({
      title: 'Lost',
      revisionId: '$x',
    }));
    expect(await listCanvases('session-a')).toHaveLength(1);
  });

  it('forgets a deleted canvas', async () => {
    await recordCanvas('session-a', entry());
    await forgetCanvas('session-a', '$canvas');
    expect(await listCanvases('session-a')).toEqual([]);
  });

  it('tells listeners of every write, since another tab may have made the change first', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasList(listener);
    await recordCanvas('session-a', entry());
    await recordCanvas('session-a', entry());
    await recordCanvasUpdate('session-a', '$canvas', 2, () => ({ title: 'v2', revisionId: '$v2' }));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    await forgetCanvas('session-a', '$canvas');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('records and reads a computer notice per conversation', async () => {
    await recordComputerShown('session-a', '!r', '$t');
    expect(await isComputerShown('session-a', '!r', '$t')).toBe(true);
    expect(await isComputerShown('session-a', '!r', undefined)).toBe(false);
    expect(await isComputerShown('session-a', '!r2', '$t')).toBe(false);
    expect(await isComputerShown('session-b', '!r', '$t')).toBe(false);
    await recordComputerShown('session-a', '!r', undefined);
    expect(await isComputerShown('session-a', '!r', undefined)).toBe(true);
  });

  it('upgrades a version 1 index without losing canvases', async () => {
    const old = await openDB(getCanvasIndexDbName('session-a'), 1, {
      upgrade(db) {
        db.createObjectStore('canvases', { keyPath: 'canvasId' });
      },
    });
    await old.put('canvases', entry());
    old.close();
    expect(await listCanvases('session-a')).toEqual([entry()]);
    await recordComputerShown('session-a', '!r', '$t');
    expect(await isComputerShown('session-a', '!r', '$t')).toBe(true);
    expect(await listCanvases('session-a')).toEqual([entry()]);
  });

  it('notifies listeners after recording a computer notice', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasList(listener);
    await recordComputerShown('session-a', '!r', '$t');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
