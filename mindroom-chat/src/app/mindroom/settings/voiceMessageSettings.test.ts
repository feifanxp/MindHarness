import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StorageListener = (event: StorageEvent) => void;

const storageState = new Map<string, string>();
const storageListeners = new Set<StorageListener>();

const emitStorageEvent = (key: string) => {
  storageListeners.forEach((listener) => listener({ key } as StorageEvent));
};

describe('voiceMessageSettings', () => {
  beforeEach(() => {
    vi.resetModules();
    storageState.clear();
    storageListeners.clear();

    vi.stubGlobal('localStorage', {
      get length() {
        return storageState.size;
      },
      clear: vi.fn(() => {
        storageState.clear();
      }),
      getItem: vi.fn((key: string) => storageState.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storageState.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storageState.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        storageState.set(key, value);
      }),
    } as unknown as Storage);

    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.delete(listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageState.clear();
    storageListeners.clear();
  });

  it('defaults storage hydration to 1', async () => {
    const { voiceMessagePlaybackRateAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessagePlaybackRateAtom, () => undefined);

    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    unmount();
  });

  it('hydrates valid persisted rates', async () => {
    storageState.set('voiceMessagePlaybackRate', '1.5');

    const { voiceMessagePlaybackRateAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessagePlaybackRateAtom, () => undefined);

    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);

    unmount();
  });

  it.each(['{not-json}', '"1.5"', '0.5', '3', 'null', 'true'])(
    'falls back to 1 for invalid persisted value %s',
    async (storedValue) => {
      storageState.set('voiceMessagePlaybackRate', storedValue);

      const { voiceMessagePlaybackRateAtom } = await import('./voiceMessageSettings');
      const store = createStore();
      const unmount = store.sub(voiceMessagePlaybackRateAtom, () => undefined);

      expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

      unmount();
    }
  );

  it('loads sanitized storage updates while mounted', async () => {
    const { voiceMessagePlaybackRateAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessagePlaybackRateAtom, () => undefined);

    storageState.set('voiceMessagePlaybackRate', '2');
    emitStorageEvent('voiceMessagePlaybackRate');
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(2);

    storageState.set('voiceMessagePlaybackRate', '4');
    emitStorageEvent('voiceMessagePlaybackRate');
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    unmount();
  });

  it('cycles rates in order', async () => {
    const { cycleVoicePlaybackRate, formatVoicePlaybackRate, VOICE_PLAYBACK_RATES } = await import(
      './voiceMessageSettings'
    );

    expect(VOICE_PLAYBACK_RATES.map(formatVoicePlaybackRate)).toEqual(['1×', '1.5×', '2×']);
    expect(cycleVoicePlaybackRate(1)).toBe(1.5);
    expect(cycleVoicePlaybackRate(1.5)).toBe(2);
    expect(cycleVoicePlaybackRate(2)).toBe(1);
  });

  it('sanitizes values before persisting', async () => {
    const { voiceMessagePlaybackRateAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessagePlaybackRateAtom, () => undefined);

    store.set(voiceMessagePlaybackRateAtom, 2);
    expect(storageState.get('voiceMessagePlaybackRate')).toBe('2');

    store.set(voiceMessagePlaybackRateAtom, 4);
    expect(storageState.get('voiceMessagePlaybackRate')).toBe('1');
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    unmount();
  });

  it('defaults volume storage hydration to 1', async () => {
    const { voiceMessageVolumeAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessageVolumeAtom, () => undefined);

    expect(store.get(voiceMessageVolumeAtom)).toBe(1);

    unmount();
  });

  it('hydrates valid persisted volume', async () => {
    storageState.set('voiceMessageVolume', '0.35');

    const { voiceMessageVolumeAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessageVolumeAtom, () => undefined);

    expect(store.get(voiceMessageVolumeAtom)).toBe(0.35);

    unmount();
  });

  it.each([
    ['-1', 0],
    ['2', 1],
    ['NaN', 1],
    ['"0.5"', 1],
  ])('sanitizes persisted volume value %s to %s', async (storedValue, expected) => {
    storageState.set('voiceMessageVolume', storedValue);

    const { voiceMessageVolumeAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessageVolumeAtom, () => undefined);

    expect(store.get(voiceMessageVolumeAtom)).toBe(expected);

    unmount();
  });

  it('persists sanitized volume updates', async () => {
    const { voiceMessageVolumeAtom } = await import('./voiceMessageSettings');
    const store = createStore();
    const unmount = store.sub(voiceMessageVolumeAtom, () => undefined);

    store.set(voiceMessageVolumeAtom, 0.25);
    expect(storageState.get('voiceMessageVolume')).toBe('0.25');

    store.set(voiceMessageVolumeAtom, -1);
    expect(storageState.get('voiceMessageVolume')).toBe('0');
    expect(store.get(voiceMessageVolumeAtom)).toBe(0);

    store.set(voiceMessageVolumeAtom, Number.NaN);
    expect(storageState.get('voiceMessageVolume')).toBe('1');
    expect(store.get(voiceMessageVolumeAtom)).toBe(1);

    unmount();
  });
});
