// @vitest-environment jsdom
import { createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPUTER_SERVICE_STORAGE_KEY,
  computerServicePreferenceAtom,
  loadComputerServicePreference,
  resolveComputerServiceUrl,
} from './computerServiceSettings';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('device computer service preference', () => {
  it.each([
    null,
    'garbage',
    '{}',
    '42',
    '"javascript:alert(1)"',
    '"https://user:password@example.org"',
    '"https://example.org/api"',
  ])('ignores missing or invalid stored configuration %s', (stored) => {
    if (stored !== null) localStorage.setItem(COMPUTER_SERVICE_STORAGE_KEY, stored);
    expect(loadComputerServicePreference()).toBeNull();
  });

  it('uses the deployment only without an override, including explicit disable', () => {
    expect(resolveComputerServiceUrl(null, 'https://deployment.example')).toBe(
      'https://deployment.example'
    );
    expect(resolveComputerServiceUrl('', 'https://deployment.example')).toBeUndefined();
    expect(resolveComputerServiceUrl('https://custom.example/', 'https://deployment.example')).toBe(
      'https://custom.example'
    );
    expect(resolveComputerServiceUrl(null, '')).toBeUndefined();
  });

  it('persists normalized origins, explicit disable, and reset before publishing changes', () => {
    const store = createStore();
    expect(store.set(computerServicePreferenceAtom, ' https://custom.example/ ')).toBe(true);
    expect(store.get(computerServicePreferenceAtom)).toBe('https://custom.example');
    expect(loadComputerServicePreference()).toBe('https://custom.example');
    expect(store.set(computerServicePreferenceAtom, '')).toBe(true);
    expect(loadComputerServicePreference()).toBe('');
    expect(store.set(computerServicePreferenceAtom, null)).toBe(true);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    expect(loadComputerServicePreference()).toBeNull();
  });

  it.each([
    'http://remote.example',
    'https://user:secret@example.org',
    'https://example.org/path',
    'https://example.org?token=secret',
    'https://example.org#secret',
    'file:///tmp',
  ])('rejects %s before persisting or changing the endpoint', (value) => {
    const store = createStore();
    expect(store.set(computerServicePreferenceAtom, value)).toBe(false);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
    expect(localStorage.getItem(COMPUTER_SERVICE_STORAGE_KEY)).toBeNull();
  });

  it('reports unavailable storage and keeps the current endpoint', () => {
    const store = createStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(store.set(computerServicePreferenceAtom, 'https://custom.example')).toBe(false);
    expect(store.get(computerServicePreferenceAtom)).toBeNull();
  });

  it('loads safely when reading storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadComputerServicePreference()).toBeNull();
  });
});
