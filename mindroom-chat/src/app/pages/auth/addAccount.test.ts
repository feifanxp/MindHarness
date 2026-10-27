import { describe, expect, it } from 'vitest';
import {
  ADD_ACCOUNT_SEARCH_PARAM,
  ADD_ACCOUNT_SEARCH_VALUE,
  isAddAccountSearch,
  resolveAddAccountReturnPath,
  withAddAccountSearch,
  withAddAccountSearchIf,
} from './addAccount';
import { getHomePath } from '../pathUtils';

describe('addAccount helpers', () => {
  it('detects the add-account search flag from strings and URLSearchParams', () => {
    expect(isAddAccountSearch(`?${ADD_ACCOUNT_SEARCH_PARAM}=${ADD_ACCOUNT_SEARCH_VALUE}`)).toBe(
      true
    );
    expect(
      isAddAccountSearch(
        new URLSearchParams(`${ADD_ACCOUNT_SEARCH_PARAM}=${ADD_ACCOUNT_SEARCH_VALUE}`)
      )
    ).toBe(true);
    expect(isAddAccountSearch('?foo=bar')).toBe(false);
  });

  it('appends the add-account flag without dropping existing query params', () => {
    expect(withAddAccountSearch('/login')).toBe('/login?addAccount=1');
    expect(withAddAccountSearch('/login?server=https%3A%2F%2Fexample.com')).toBe(
      '/login?server=https%3A%2F%2Fexample.com&addAccount=1'
    );
  });

  it('conditionally appends the add-account flag', () => {
    expect(withAddAccountSearchIf('/login', true)).toBe('/login?addAccount=1');
    expect(withAddAccountSearchIf('/login', false)).toBe('/login');
  });

  it('restores the active account path only for add-account auth flows', () => {
    expect(
      resolveAddAccountReturnPath('?addAccount=1', {
        lastKnownPath: '/home/%23room%3Amindroom.chat?threadId=%24abc',
      })
    ).toBe('/home/%23room%3Amindroom.chat?threadId=%24abc');
    expect(resolveAddAccountReturnPath('?addAccount=1', { lastKnownPath: undefined })).toBe(
      getHomePath()
    );
    expect(resolveAddAccountReturnPath('', { lastKnownPath: '/home' })).toBeUndefined();
    expect(resolveAddAccountReturnPath('?addAccount=1')).toBeUndefined();
  });
});
