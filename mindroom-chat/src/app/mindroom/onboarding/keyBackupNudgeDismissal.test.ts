import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dismissKeyBackupNudge,
  getKeyBackupNudgeDismissStorageKey,
  readKeyBackupNudgeDismissed,
} from './keyBackupNudgeDismissal';

const makeMemoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  };
};

describe('keyBackupNudge dismissal storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scopes the dismiss key per user id', () => {
    expect(getKeyBackupNudgeDismissStorageKey('@alice:example.org')).toBe(
      'mindroom.keyBackupNudgeDismissed:@alice:example.org'
    );
    expect(getKeyBackupNudgeDismissStorageKey('@bob:example.org')).not.toBe(
      getKeyBackupNudgeDismissStorageKey('@alice:example.org')
    );
  });

  it('reads false before dismissal and true after, per user', () => {
    vi.stubGlobal('localStorage', makeMemoryStorage());

    expect(readKeyBackupNudgeDismissed('@alice:example.org')).toBe(false);

    dismissKeyBackupNudge('@alice:example.org');

    expect(readKeyBackupNudgeDismissed('@alice:example.org')).toBe(true);
    // A different account is unaffected.
    expect(readKeyBackupNudgeDismissed('@bob:example.org')).toBe(false);
  });

  it('fails closed to not-dismissed when storage reads throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(readKeyBackupNudgeDismissed('@alice:example.org')).toBe(false);
  });

  it('is a no-op and stays not-dismissed when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => dismissKeyBackupNudge('@alice:example.org')).not.toThrow();
    expect(readKeyBackupNudgeDismissed('@alice:example.org')).toBe(false);
  });
});
