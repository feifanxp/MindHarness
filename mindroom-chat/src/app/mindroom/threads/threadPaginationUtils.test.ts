import { Direction } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  computeReconciliationToken,
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';

// Minimal MatrixEvent-like stub for testing
const makeEvent = (
  eventId: string,
  threadRootId: string | undefined,
  ts: number
) => ({
  getId: () => eventId,
  getTs: () => ts,
  threadRootId,
});

describe('findEarliestLoadedThreadReplyByCacheOrder', () => {
  const threadId = '$root';

  it('returns the reply with the lowest timestamp', () => {
    const events = [
      makeEvent('$root', undefined, 100),
      makeEvent('$reply-b', '$root', 300),
      makeEvent('$reply-a', '$root', 200),
    ];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    expect(result?.getId()).toBe('$reply-a');
  });

  it('uses event id as tie-breaker for same-timestamp replies', () => {
    const events = [
      makeEvent('$root', undefined, 100),
      makeEvent('$c', '$root', 200),
      makeEvent('$a', '$root', 200),
      makeEvent('$b', '$root', 200),
    ];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    // Lexicographically smallest event id wins
    expect(result?.getId()).toBe('$a');
  });

  it('excludes the thread root from selection', () => {
    const events = [
      makeEvent('$root', undefined, 50),
      makeEvent('$reply', '$root', 200),
    ];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    expect(result?.getId()).toBe('$reply');
  });

  it('returns undefined when there are no replies', () => {
    const events = [makeEvent('$root', undefined, 100)];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty events array', () => {
    const result = findEarliestLoadedThreadReplyByCacheOrder([] as any, threadId);
    expect(result).toBeUndefined();
  });

  it('skips events without an id', () => {
    const events = [
      { getId: () => undefined, getTs: () => 100, threadRootId: '$root' },
      makeEvent('$reply', '$root', 200),
    ];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    expect(result?.getId()).toBe('$reply');
  });

  it('skips events that do not belong to the thread', () => {
    const events = [
      makeEvent('$other-thread-reply', '$different-root', 50),
      makeEvent('$reply', '$root', 200),
    ];
    const result = findEarliestLoadedThreadReplyByCacheOrder(events as any, threadId);
    expect(result?.getId()).toBe('$reply');
  });
});

describe('reconcileThreadBackwardPagination', () => {
  const makeTimeline = () => ({
    setPaginationToken: vi.fn(),
  });

  it('clears token and hides button when cachedToken is null (no more pages)', () => {
    const timeline = makeTimeline();
    const setHasMore = vi.fn();

    reconcileThreadBackwardPagination(timeline as any, null, setHasMore);

    expect(timeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(setHasMore).toHaveBeenCalledWith(false);
  });

  it('sets token and shows button when cachedToken is a string (more pages)', () => {
    const timeline = makeTimeline();
    const setHasMore = vi.fn();

    reconcileThreadBackwardPagination(timeline as any, 'some-token', setHasMore);

    expect(timeline.setPaginationToken).toHaveBeenCalledWith('some-token', Direction.Backward);
    expect(setHasMore).toHaveBeenCalledWith(true);
  });

  it('preserves SDK token when cachedToken is undefined (no cache data)', () => {
    const timeline = makeTimeline();
    const setHasMore = vi.fn();

    reconcileThreadBackwardPagination(timeline as any, undefined, setHasMore);

    expect(timeline.setPaginationToken).not.toHaveBeenCalled();
    expect(setHasMore).not.toHaveBeenCalled();
  });

  it('reconciles stale string→null: overwrites previous string token with null', () => {
    // Simulates reopening a thread where the cache previously had a string token
    // but server now reports no more pages (null).
    const timeline = makeTimeline();
    const setHasMore = vi.fn();

    // First: string token was set (long thread)
    reconcileThreadBackwardPagination(timeline as any, 'stale-token', setHasMore);
    expect(setHasMore).toHaveBeenCalledWith(true);
    expect(timeline.setPaginationToken).toHaveBeenCalledWith('stale-token', Direction.Backward);

    // Second: server now says no more pages (short thread after cleanup)
    reconcileThreadBackwardPagination(timeline as any, null, setHasMore);
    expect(timeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(setHasMore).toHaveBeenLastCalledWith(false);
  });

  it('handles undefined timeline gracefully', () => {
    const setHasMore = vi.fn();

    // Should not throw when timeline is undefined
    expect(() =>
      reconcileThreadBackwardPagination(undefined, null, setHasMore)
    ).not.toThrow();
    expect(setHasMore).toHaveBeenCalledWith(false);

    expect(() =>
      reconcileThreadBackwardPagination(undefined, 'token', setHasMore)
    ).not.toThrow();
    expect(setHasMore).toHaveBeenCalledWith(true);
  });

  it('clears stale cached state when no Thread model exists (no-Thread fallback)', () => {
    // Simulates the scenario where room.getThread() returns null but cache
    // hydration eagerly set threadHasMoreCachedBack=true from a stale
    // beforeToken. The fallback path should reconcile with server's null
    // next_batch to clear the bogus button.
    const setHasMore = vi.fn();

    // Stale state: cache had a token, so setHasMore was called with true
    setHasMore(true);
    setHasMore.mockClear();

    // Server says short thread (no next_batch → null token), no Thread model
    reconcileThreadBackwardPagination(undefined, null, setHasMore);
    expect(setHasMore).toHaveBeenCalledWith(false);
  });
});

describe('computeReconciliationToken', () => {
  const threadId = '$root';

  it('returns null when server says no more pages (short thread)', () => {
    const fetched = [makeEvent('$a', '$root', 200), makeEvent('$b', '$root', 300)];
    const loaded = [...fetched];
    const result = computeReconciliationToken(null, fetched as any, loaded as any, threadId);
    expect(result).toBeNull();
  });

  it('returns null even when loaded has older events than fetched (server is authoritative)', () => {
    const fetched = [makeEvent('$b', '$root', 300)];
    const loaded = [makeEvent('$old', '$root', 100), makeEvent('$b', '$root', 300)];
    const result = computeReconciliationToken(null, fetched as any, loaded as any, threadId);
    expect(result).toBeNull();
  });

  it('returns server token when earliest loaded matches earliest fetched', () => {
    const fetched = [makeEvent('$a', '$root', 200), makeEvent('$b', '$root', 300)];
    const loaded = [...fetched];
    const result = computeReconciliationToken('tok_abc', fetched as any, loaded as any, threadId);
    expect(result).toBe('tok_abc');
  });

  it('returns undefined when earliest loaded is older than earliest fetched', () => {
    const fetched = [makeEvent('$b', '$root', 300)];
    const loaded = [makeEvent('$old', '$root', 100), makeEvent('$b', '$root', 300)];
    const result = computeReconciliationToken('tok_abc', fetched as any, loaded as any, threadId);
    expect(result).toBeUndefined();
  });

  it('returns undefined when fetched events are empty', () => {
    const loaded = [makeEvent('$a', '$root', 200)];
    const result = computeReconciliationToken('tok_abc', [] as any, loaded as any, threadId);
    expect(result).toBeUndefined();
  });

  it('returns undefined when loaded events are empty', () => {
    const fetched = [makeEvent('$a', '$root', 200)];
    const result = computeReconciliationToken('tok_abc', fetched as any, [] as any, threadId);
    expect(result).toBeUndefined();
  });

  it('returns null when both fetched and loaded are empty and server says no more', () => {
    const result = computeReconciliationToken(null, [] as any, [] as any, threadId);
    expect(result).toBeNull();
  });

  it('returns server token when loaded is a superset of fetched with same earliest', () => {
    const fetched = [makeEvent('$a', '$root', 200), makeEvent('$b', '$root', 300)];
    const loaded = [makeEvent('$a', '$root', 200), makeEvent('$b', '$root', 300), makeEvent('$c', '$root', 400)];
    const result = computeReconciliationToken('tok_abc', fetched as any, loaded as any, threadId);
    expect(result).toBe('tok_abc');
  });

  it('excludes thread root from earliest-reply comparison', () => {
    // Root is oldest but should be excluded — earliest reply matches
    const fetched = [makeEvent('$root', undefined, 50), makeEvent('$a', '$root', 200)];
    const loaded = [makeEvent('$root', undefined, 50), makeEvent('$a', '$root', 200)];
    const result = computeReconciliationToken('tok_abc', fetched as any, loaded as any, threadId);
    expect(result).toBe('tok_abc');
  });
});
