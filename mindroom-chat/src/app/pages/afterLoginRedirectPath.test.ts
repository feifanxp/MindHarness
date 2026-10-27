// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS,
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
  setAfterLoginRedirectPath,
} from './afterLoginRedirectPath';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('after-login redirect path', () => {
  it('returns a recently saved path', () => {
    setAfterLoginRedirectPath('/connect?code=ABCD-EFGH');

    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');

    deleteAfterLoginRedirectPath();
    expect(getAfterLoginRedirectPath()).toBeUndefined();
  });

  it('drops a path saved by an abandoned login after 15 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T12:00:00.000Z'));
    setAfterLoginRedirectPath('/connect?code=ABCD-EFGH');

    vi.setSystemTime(Date.now() + AFTER_LOGIN_REDIRECT_PATH_MAX_AGE_MS - 1);
    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');

    vi.setSystemTime(Date.now() + 2);
    expect(getAfterLoginRedirectPath()).toBeUndefined();
    expect(localStorage.getItem('after_login_redirect_url')).toBeNull();
  });

  it('ignores untimestamped values from earlier releases', () => {
    localStorage.setItem('after_login_redirect_url', '/home/');

    expect(getAfterLoginRedirectPath()).toBeUndefined();
  });
});
