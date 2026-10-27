import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_SEARCH_FETCH_THRESHOLD_PX,
  shouldFetchNextMessageSearchPage,
} from './messageSearchPagination';

describe('shouldFetchNextMessageSearchPage', () => {
  it('returns false when there is no next page', () => {
    expect(
      shouldFetchNextMessageSearchPage({
        hasNextPage: false,
        isFetchingNextPage: false,
        scrollTop: 0,
        clientHeight: 800,
        scrollHeight: 1600,
      })
    ).toBe(false);
  });

  it('returns false while a next page is already being fetched', () => {
    expect(
      shouldFetchNextMessageSearchPage({
        hasNextPage: true,
        isFetchingNextPage: true,
        scrollTop: 0,
        clientHeight: 800,
        scrollHeight: 1600,
      })
    ).toBe(false);
  });

  it('returns true when the viewport is near the bottom of the real scroll height', () => {
    expect(
      shouldFetchNextMessageSearchPage({
        hasNextPage: true,
        isFetchingNextPage: false,
        scrollTop: 1000,
        clientHeight: 800,
        scrollHeight: 2300,
      })
    ).toBe(true);
  });

  it('returns false when there is still more than the threshold left to scroll', () => {
    expect(
      shouldFetchNextMessageSearchPage({
        hasNextPage: true,
        isFetchingNextPage: false,
        scrollTop: 200,
        clientHeight: 800,
        scrollHeight: 2000,
      })
    ).toBe(false);
  });

  it('uses the default threshold when one is not provided', () => {
    expect(
      shouldFetchNextMessageSearchPage({
        hasNextPage: true,
        isFetchingNextPage: false,
        scrollTop: 0,
        clientHeight: 1000,
        scrollHeight: 1000 + DEFAULT_MESSAGE_SEARCH_FETCH_THRESHOLD_PX,
      })
    ).toBe(true);
  });
});
