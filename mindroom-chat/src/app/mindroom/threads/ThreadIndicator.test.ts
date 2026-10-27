import { describe, expect, it } from 'vitest';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';

const makeEvent = (threadMeta?: Record<string, unknown>) =>
  ({
    getUnsigned: () =>
      threadMeta
        ? {
            'm.relations': {
              'm.thread': threadMeta,
            },
          }
        : {},
  } as never);

describe('getThreadRootReplyCount', () => {
  it('reads current Matrix thread count metadata', () => {
    expect(getThreadRootReplyCount(makeEvent({ count: 3 }))).toBe(3);
  });

  it('supports legacy short-count thread metadata', () => {
    expect(getThreadRootReplyCount(makeEvent({ c: 2 }))).toBe(2);
  });

  it('ignores missing or malformed thread metadata', () => {
    expect(getThreadRootReplyCount(makeEvent())).toBeUndefined();
    expect(getThreadRootReplyCount(makeEvent({ count: '3', c: null }))).toBeUndefined();
  });
});
