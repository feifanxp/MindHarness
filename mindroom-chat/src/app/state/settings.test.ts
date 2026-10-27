import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

let storageValue: string | null = null;

beforeAll(() => {
  globalThis.localStorage = {
    getItem: () => storageValue,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    length: 0,
    key: () => null,
  };
});

describe('settings ownership', () => {
  it('does not own MindRoom pagination policy in generic settings state', () => {
    const source = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('DEFAULT_PAGINATION_LIMIT');
    expect(source).not.toContain('sanitizePaginationLimit');
    expect(source).not.toContain('paginationLimit:');
    expect(source).not.toContain('../mindroom/threads/preloadSettings');
    expect(source).not.toContain('../mindroom/settings');
  });
});

describe('getSettings', () => {
  it('falls back to defaults when stored settings JSON is malformed', async () => {
    const { getSettings } = await import('./settings');
    storageValue = '{not json}';

    expect(() => getSettings()).not.toThrow();
    expect(getSettings().useSystemTheme).toBe(true);

    storageValue = null;
  });

  it('sanitizes persisted page zoom values', async () => {
    const { getSettings, PAGE_ZOOM_DEFAULT, PAGE_ZOOM_MAX, PAGE_ZOOM_MIN } = await import(
      './settings'
    );

    storageValue = JSON.stringify({ pageZoom: 0 });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_MIN);

    storageValue = JSON.stringify({ pageZoom: 200 });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_MAX);

    storageValue = JSON.stringify({ pageZoom: Number.NaN });
    expect(getSettings().pageZoom).toBe(PAGE_ZOOM_DEFAULT);

    storageValue = JSON.stringify({ pageZoom: 89.6 });
    expect(getSettings().pageZoom).toBe(90);

    storageValue = null;
  });

  it('hydrates only fields owned by the generic settings model', async () => {
    const { getSettings } = await import('./settings');
    storageValue = JSON.stringify({
      pageZoom: 90,
      forkExtension: 'not-owned-here',
    });

    const settings = getSettings() as Record<string, unknown>;
    expect(settings.pageZoom).toBe(90);
    expect(settings.forkExtension).toBeUndefined();

    storageValue = null;
  });

  it('falls back to defaults when localStorage lacks getItem', async () => {
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: () => undefined,
      },
    });

    try {
      const { getSettings, PAGE_ZOOM_DEFAULT } = await import('./settings');
      expect(getSettings().pageZoom).toBe(PAGE_ZOOM_DEFAULT);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  });
});
