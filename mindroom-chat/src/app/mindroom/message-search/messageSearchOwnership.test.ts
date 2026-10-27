import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('message search ownership boundaries', () => {
  it('keeps the whole message-search implementation in the MindRoom namespace', () => {
    const searchResultGroupSource = readFileSync(
      new URL('./SearchResultGroup.tsx', import.meta.url),
      'utf8'
    );
    const messageSearchSource = readFileSync(
      new URL('./MessageSearch.tsx', import.meta.url),
      'utf8'
    );
    const mindroomMessageSearchSource = readFileSync(
      new URL('./MindroomMessageSearch.tsx', import.meta.url),
      'utf8'
    );
    const rendererSource = readFileSync(
      new URL('./searchResultBodyRenderer.tsx', import.meta.url),
      'utf8'
    );
    const oldFeaturePath = new URL('../../features/message-search', import.meta.url);

    expect(searchResultGroupSource).toContain('renderBody');
    expect(searchResultGroupSource).not.toContain('MindroomSearchResultBody');
    expect(messageSearchSource).toContain('renderBody');
    expect(messageSearchSource).not.toContain('MindroomSearchResultBody');
    expect(mindroomMessageSearchSource).toContain('renderMindroomSearchResultBody');
    expect(rendererSource).toContain('MindroomSearchResultBody');
    expect(existsSync(oldFeaturePath)).toBe(false);
  });
});
