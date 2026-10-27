import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearThreadSummarySharedState,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';

vi.mock('./cacheStore', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));

describe('threadSummaryState cleanup', () => {
  beforeEach(() => {
    clearThreadSummarySharedState();
  });

  it('evicts only the removed session so re-adding it cannot reuse stale summaries', () => {
    const summary = {
      summaryText: 'stale summary',
      generatedTs: 1,
      messageCount: 1,
    };
    storeThreadSummaryInState('session-a', '!room:example.org', '$thread-a', summary);
    storeThreadSummaryInState('session-b', '!room:example.org', '$thread-b', summary);

    clearThreadSummarySharedState('session-a');

    expect(getThreadSummaryStateSnapshot('session-a', '!room:example.org')).toEqual(new Map());
    expect(getThreadSummaryStateSnapshot('session-b', '!room:example.org').has('$thread-b')).toBe(
      true
    );
  });
});
