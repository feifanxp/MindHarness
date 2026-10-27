import { describe, expect, it } from 'vitest';
import { getHomePath } from '../pathUtils';
import { buildSessionLastKnownPath, resolveSessionRestorePath } from './sessionRouteRestore';

describe('sessionRouteRestore', () => {
  it('builds the persisted route from pathname, search, and hash', () => {
    expect(
      buildSessionLastKnownPath({
        pathname: '/space/%23lobby%3Amindroom.chat',
        search: '?threadId=%24abc',
        hash: '#reply',
      })
    ).toBe('/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply');
  });

  it('restores valid in-app paths and falls back to home for invalid ones', () => {
    expect(resolveSessionRestorePath('/home/%23room%3Amindroom.chat?threadId=%24abc')).toBe(
      '/home/%23room%3Amindroom.chat?threadId=%24abc'
    );
    expect(resolveSessionRestorePath(undefined)).toBe(getHomePath());
    expect(resolveSessionRestorePath('')).toBe(getHomePath());
    expect(resolveSessionRestorePath('//evil.com')).toBe(getHomePath());
    expect(resolveSessionRestorePath('https://example.com/outside')).toBe(getHomePath());
  });
});
