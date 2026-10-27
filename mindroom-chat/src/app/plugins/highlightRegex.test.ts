import { describe, expect, it } from 'vitest';
import { makeHighlightRegex } from './highlightRegex';

describe('makeHighlightRegex', () => {
  it('ignores empty highlight tokens', () => {
    const regex = makeHighlightRegex(['cinny', '', '024', '   ']);

    expect(regex).toBeInstanceOf(RegExp);
    expect(regex?.source).toBe('cinny|024');
  });

  it('returns undefined when every highlight token is empty', () => {
    expect(makeHighlightRegex(['', '   '])).toBeUndefined();
  });
});
