import { describe, expect, it } from 'vitest';
import { applyOrderOverride } from './applyOrderOverride';

describe('applyOrderOverride', () => {
  it('returns the default ids by identity when the override is empty', () => {
    const defaultIds = ['!a', '!b', '!c'];

    expect(applyOrderOverride(defaultIds, [])).toBe(defaultIds);
  });

  it('uses the override order for ids that still exist', () => {
    expect(applyOrderOverride(['!a', '!b', '!c'], ['!c', '!a', '!b'])).toEqual([
      '!c',
      '!a',
      '!b',
    ]);
  });

  it('appends missing default ids after overridden ids', () => {
    expect(applyOrderOverride(['!a', '!b', '!c', '!d'], ['!c', '!a'])).toEqual([
      '!c',
      '!a',
      '!b',
      '!d',
    ]);
  });

  it('drops override ids that no longer exist', () => {
    expect(applyOrderOverride(['!a', '!b', '!c'], ['!missing', '!c', '!a'])).toEqual([
      '!c',
      '!a',
      '!b',
    ]);
  });

  it('dedupes override ids', () => {
    expect(applyOrderOverride(['!a', '!b', '!c'], ['!b', '!b', '!a'])).toEqual([
      '!b',
      '!a',
      '!c',
    ]);
  });
});
