import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, string>();

describe('MindRoom local settings storage', () => {
  beforeEach(() => {
    vi.resetModules();
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => values.delete(key)),
      clear: vi.fn(() => values.clear()),
      length: 0,
      key: vi.fn(),
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates v1 implicit homeserver scope while preserving explicit all-room opt-in', async () => {
    const { loadMindroomSettings, migrateMindroomSettingsStorage } = await import(
      './mindroomSettingsStorage'
    );
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'my-server', prefetchDepth: 2000 })
    );
    expect(loadMindroomSettings().prefetchScope).toBe('current-room-only');
    expect(migrateMindroomSettingsStorage()).toBe(true);
    expect(JSON.parse(values.get('mindroomSettings')!).v).toBe(2);
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'all-rooms', prefetchDepth: 2000 })
    );
    expect(loadMindroomSettings().prefetchScope).toBe('all-rooms');
  });

  it('hydrates legacy extension fields without mapping the deleted pagination limit', async () => {
    values.set(
      'settings',
      JSON.stringify({ paginationLimit: 120, prefetchScope: 'all-rooms', prefetchDepth: 2500 })
    );
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const snapshot = createStore().get(mindroomSettingsAtom);

    expect(snapshot).toEqual({ prefetchScope: 'all-rooms', prefetchDepth: 2500 });
    expect(snapshot).not.toHaveProperty('paginationLimit');
  });

  it('defaults invalid values in the versioned store', async () => {
    values.set(
      'mindroomSettings',
      JSON.stringify({ v: 1, prefetchScope: 'invalid', prefetchDepth: 'many' })
    );
    const { mindroomSettingsAtom } = await import('./mindroomSettings');

    expect(createStore().get(mindroomSettingsAtom)).toEqual({
      prefetchScope: 'current-room-only',
      prefetchDepth: 10000,
    });
  });

  it('writes only the versioned MindRoom-owned store', async () => {
    values.set('settings', JSON.stringify({ pageZoom: 90 }));
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    store.set(mindroomSettingsAtom, {
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
    });

    expect(JSON.parse(values.get('mindroomSettings') ?? '{}')).toEqual({
      v: 2,
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
    });
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({ pageZoom: 90 });
  });

  it('migrates legacy fields explicitly and preserves Cinny settings', async () => {
    values.set(
      'settings',
      JSON.stringify({
        pageZoom: 90,
        paginationLimit: 120,
        prefetchScope: 'all-rooms',
        prefetchDepth: 2000,
      })
    );
    const { migrateMindroomSettingsStorage } = await import('./mindroomSettingsStorage');

    expect(migrateMindroomSettingsStorage()).toBe(true);
    expect(JSON.parse(values.get('mindroomSettings') ?? '{}')).toEqual({
      v: 2,
      prefetchScope: 'all-rooms',
      prefetchDepth: 2000,
    });
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({ pageZoom: 90 });
  });

  it('does not mutate storage merely by importing or reading settings', async () => {
    const legacy = JSON.stringify({ pageZoom: 90, paginationLimit: 120 });
    values.set('settings', legacy);
    const { loadMindroomSettings } = await import('./mindroomSettingsStorage');

    expect(loadMindroomSettings()).toEqual({
      prefetchScope: 'current-room-only',
      prefetchDepth: 10000,
    });
    expect(values.get('settings')).toBe(legacy);
    expect(values.has('mindroomSettings')).toBe(false);
  });

  it('keeps legacy values when the versioned store cannot be written', async () => {
    values.set(
      'settings',
      JSON.stringify({ pageZoom: 90, prefetchScope: 'all-rooms', prefetchDepth: 2000 })
    );
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { migrateMindroomSettingsStorage } = await import('./mindroomSettingsStorage');

    expect(migrateMindroomSettingsStorage()).toBe(false);
    expect(JSON.parse(values.get('settings') ?? '{}')).toEqual({
      pageZoom: 90,
      prefetchScope: 'all-rooms',
      prefetchDepth: 2000,
    });
  });

  it('does not overwrite a newer versioned store on downgrade', async () => {
    const future = JSON.stringify({ v: 3, prefetchScope: 'future', prefetchDepth: 42 });
    values.set('mindroomSettings', future);
    const { migrateMindroomSettingsStorage } = await import('./mindroomSettingsStorage');

    expect(migrateMindroomSettingsStorage()).toBe(false);
    expect(values.get('mindroomSettings')).toBe(future);
  });

  it('does not overwrite a newer store through an ordinary atom write', async () => {
    const future = JSON.stringify({ v: 3, prefetchScope: 'future', prefetchDepth: 42 });
    values.set('mindroomSettings', future);
    const { mindroomSettingsAtom } = await import('./mindroomSettings');
    const store = createStore();

    store.set(mindroomSettingsAtom, {
      prefetchScope: 'current-room-only',
      prefetchDepth: 3000,
    });

    expect(values.get('mindroomSettings')).toBe(future);
  });
});
