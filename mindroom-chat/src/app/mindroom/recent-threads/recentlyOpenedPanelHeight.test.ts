import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT,
  MAX_RECENTLY_OPENED_PANEL_HEIGHT,
  MIN_RECENTLY_OPENED_PANEL_HEIGHT,
  clearRecentlyOpenedPanelHeightStore,
  getRecentlyOpenedPanelHeightStoreKey,
  makeRecentlyOpenedPanelHeightAtom,
  normalizeRecentlyOpenedPanelHeight,
} from './recentlyOpenedPanelHeight';

const USER_ID = '@alice:example.org';
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  clearRecentlyOpenedPanelHeightStore(USER_ID);
});

afterEach(() => {
  clearRecentlyOpenedPanelHeightStore(USER_ID);
  vi.unstubAllGlobals();
});

describe('Recently Opened panel height', () => {
  it('normalizes invalid and out-of-range preferences', () => {
    expect(normalizeRecentlyOpenedPanelHeight(undefined)).toBe(
      DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT
    );
    expect(normalizeRecentlyOpenedPanelHeight(Number.NaN)).toBe(
      DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT
    );
    expect(normalizeRecentlyOpenedPanelHeight(-1)).toBe(DEFAULT_RECENTLY_OPENED_PANEL_HEIGHT);
    expect(normalizeRecentlyOpenedPanelHeight(1)).toBe(MIN_RECENTLY_OPENED_PANEL_HEIGHT);
    expect(normalizeRecentlyOpenedPanelHeight(400.4)).toBe(400);
    expect(normalizeRecentlyOpenedPanelHeight(10_000)).toBe(MAX_RECENTLY_OPENED_PANEL_HEIGHT);
  });

  it('persists one preferred height per account', () => {
    const store = createStore();
    const heightAtom = makeRecentlyOpenedPanelHeightAtom(USER_ID);

    store.set(heightAtom, 444);

    expect(store.get(heightAtom)).toBe(444);
    expect(storage.get(getRecentlyOpenedPanelHeightStoreKey(USER_ID))).toBe('444');
  });
});
