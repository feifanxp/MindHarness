import { describe, expect, it } from 'vitest';
import {
  isMindroomHomeserver,
  normalizeHomeserverName,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
} from './authPolicy';

describe('MindRoom auth policy', () => {
  it('normalizes server names before matching the hosted homeserver', () => {
    expect(normalizeHomeserverName('https://mindroom.chat/')).toBe('mindroom.chat');
    expect(normalizeHomeserverName('HTTP://MINDROOM.CHAT///')).toBe('mindroom.chat');
    expect(isMindroomHomeserver('https://mindroom.chat/')).toBe(true);
    expect(isMindroomHomeserver('https://123.matrix.mindroom.chat/')).toBe(true);
    expect(isMindroomHomeserver('123.matrix.mindroom.chat')).toBe(true);
    expect(isMindroomHomeserver('matrix.org')).toBe(false);
  });

  it('matches the hosted homeserver by hostname, not by a path that ends like one', () => {
    expect(isMindroomHomeserver('https://example.org/x.matrix.mindroom.chat')).toBe(false);
    expect(isMindroomHomeserver('example.org/x.matrix.mindroom.chat')).toBe(false);
  });

  it('forces the hosted homeserver onto SSO-only auth', () => {
    expect(shouldDisablePasswordLogin('mindroom.chat', undefined)).toBe(true);
    expect(shouldDisablePasswordLogin('https://123.matrix.mindroom.chat', undefined)).toBe(false);
    expect(
      shouldDisablePasswordLogin('https://123.matrix.mindroom.chat', {
        disablePasswordLogin: true,
      })
    ).toBe(true);
    expect(shouldDisablePasswordLogin('matrix.org', { disablePasswordLogin: true })).toBe(true);
    expect(shouldDisablePasswordLogin('matrix.org', undefined)).toBe(false);
    expect(shouldUseSsoOnlyRegistration('https://mindroom.chat')).toBe(true);
    expect(shouldUseSsoOnlyRegistration('https://123.matrix.mindroom.chat')).toBe(false);
    expect(shouldUseSsoOnlyRegistration('https://matrix.org')).toBe(false);
  });

  it('requires Apple only for the primary MindRoom homeserver', () => {
    expect(shouldRequireAppleProvider('mindroom.chat', { requireAppleProvider: true })).toBe(true);
    expect(
      shouldRequireAppleProvider('https://123.matrix.mindroom.chat', {
        requireAppleProvider: true,
      })
    ).toBe(false);
    expect(shouldRequireAppleProvider('matrix.org', { requireAppleProvider: true })).toBe(false);
    expect(shouldRequireAppleProvider('mindroom.chat', undefined)).toBe(false);
  });
});
