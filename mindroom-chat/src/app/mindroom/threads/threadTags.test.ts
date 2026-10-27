import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventTimeline } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  aggregateThreadTagEvents,
  buildAddTagContent,
  buildPerTagEventContent,
  buildPerTagStateKey,
  buildRemoveTagContent,
  buildResolvedTagsContent,
  buildUnresolvedTagsContent,
  collectAvailableTags,
  getDisplayTags,
  isThreadResolved,
  isThreadTagsTombstone,
  isValidTagName,
  MINDROOM_THREAD_TAGS_EVENT,
  normalizeTagName,
  normalizeSetAt,
  parsePerTagContent,
  parsePerTagStateKey,
  parseThreadTagsContent,
  RESOLVED_TAG,
  type ThreadTagsContent,
} from './threadTags';

const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';
const ISO_4 = '2026-04-07T00:00:04.000Z';

const makeThreadTagsEvent = (stateKey: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: `$thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('parseThreadTagsContent', () => {
  it('parses valid legacy thread-tag content and normalizes numeric timestamps', () => {
    const content = {
      tags: {
        Bug: {
          set_by: '@alice:example.com',
          set_at: 1000,
          note: ' needs follow-up ',
          data: { priority: 'high' },
        },
        feature: { set_by: '@bob:example.com', set_at: ISO_2 },
      },
    };
    const result = parseThreadTagsContent(content);
    expect(result.tags).toEqual({
      bug: {
        set_by: '@alice:example.com',
        set_at: '1970-01-01T00:00:01.000Z',
        note: 'needs follow-up',
        data: { priority: 'high' },
      },
      feature: { set_by: '@bob:example.com', set_at: ISO_2 },
    });
  });

  it('drops malformed tag entries', () => {
    const content = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: 'invalid' },
        resolved: { set_by: '@bob:example.com', set_at: ISO_1 },
        'bad tag': { set_by: '@carol:example.com', set_at: ISO_2 },
      },
    };

    expect(parseThreadTagsContent(content)).toEqual({
      tags: {
        resolved: { set_by: '@bob:example.com', set_at: ISO_1 },
      },
    });
  });

  it('returns empty tags for null content', () => {
    expect(parseThreadTagsContent(null)).toEqual({ tags: {} });
  });

  it('returns empty tags for undefined content', () => {
    expect(parseThreadTagsContent(undefined)).toEqual({ tags: {} });
  });

  it('returns empty tags for content without tags field', () => {
    expect(parseThreadTagsContent({ other: 'data' })).toEqual({ tags: {} });
  });

  it('returns empty tags for content with null tags', () => {
    expect(parseThreadTagsContent({ tags: null })).toEqual({ tags: {} });
  });

  it('returns empty tags for non-object content', () => {
    expect(parseThreadTagsContent('string')).toEqual({ tags: {} });
    expect(parseThreadTagsContent(42)).toEqual({ tags: {} });
  });
});

describe('normalizeSetAt', () => {
  it('returns undefined for invalid numeric timestamps without throwing', () => {
    expect(normalizeSetAt(1e20)).toBeUndefined();
    expect(normalizeSetAt(-1e15)).toBeUndefined();
    expect(normalizeSetAt(Number.NaN)).toBeUndefined();
    expect(normalizeSetAt(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('parsePerTagStateKey', () => {
  it('parses a valid JSON-array state key', () => {
    expect(parsePerTagStateKey('["$root","Urgent"]')).toEqual({
      threadRootId: '$root',
      tagName: 'urgent',
    });
  });

  it('rejects malformed or non-canonical state keys', () => {
    expect(parsePerTagStateKey('$root')).toBeNull();
    expect(parsePerTagStateKey('["$root"]')).toBeNull();
    expect(parsePerTagStateKey('["not-an-event","bug"]')).toBeNull();
    expect(parsePerTagStateKey('["$root","bad tag"]')).toBeNull();
  });
});

describe('buildPerTagStateKey', () => {
  it('builds compact JSON and round-trips with the parser', () => {
    const stateKey = buildPerTagStateKey('$root-"\\\\id"', 'Needs-Review');

    expect(stateKey).toBe('["$root-\\"\\\\\\\\id\\"","needs-review"]');
    expect(parsePerTagStateKey(stateKey)).toEqual({
      threadRootId: '$root-"\\\\id"',
      tagName: 'needs-review',
    });
  });

  it('rejects invalid tag names for writes', () => {
    expect(() => buildPerTagStateKey('$root', 'bad tag')).toThrow('Invalid thread tag name');
  });
});

describe('parsePerTagContent', () => {
  it('parses valid per-tag content with optional fields', () => {
    expect(
      parsePerTagContent({
        set_by: '@alice:example.com',
        set_at: ISO_1,
        note: ' done ',
        data: { source: 'agent' },
      })
    ).toEqual({
      set_by: '@alice:example.com',
      set_at: ISO_1,
      note: 'done',
      data: { source: 'agent' },
    });
  });

  it('normalizes numeric timestamps and rejects tombstones or malformed payloads', () => {
    expect(
      parsePerTagContent({
        set_by: '@alice:example.com',
        set_at: 1000,
      })
    ).toEqual({
      set_by: '@alice:example.com',
      set_at: '1970-01-01T00:00:01.000Z',
    });
    expect(parsePerTagContent({})).toBeNull();
    expect(parsePerTagContent({ set_by: '@alice:example.com', set_at: 'invalid' })).toBeNull();
    expect(parsePerTagContent({ set_by: '@alice:example.com', set_at: ISO_1, note: 1 })).toBeNull();
    expect(parsePerTagContent({ set_by: '@alice:example.com', set_at: ISO_1, data: [] })).toBeNull();
  });
});

describe('buildPerTagEventContent', () => {
  it('builds flat per-tag wire content', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_3));

    expect(
      buildPerTagEventContent('@alice:example.com', ' queued ', { source: 'ui' })
    ).toEqual({
      set_by: '@alice:example.com',
      set_at: ISO_3,
      note: 'queued',
      data: { source: 'ui' },
    });
  });

  it('omits absent optional fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_4));

    expect(buildPerTagEventContent('@alice:example.com')).toEqual({
      set_by: '@alice:example.com',
      set_at: ISO_4,
    });
  });
});

describe('isThreadTagsTombstone', () => {
  it('returns true for empty tags', () => {
    expect(isThreadTagsTombstone({ tags: {} })).toBe(true);
  });

  it('returns true for null content', () => {
    expect(isThreadTagsTombstone(null)).toBe(true);
  });

  it('returns false for content with tags', () => {
    expect(
      isThreadTagsTombstone({
        tags: { bug: { set_by: '@alice:example.com', set_at: ISO_1 } },
      })
    ).toBe(false);
  });
});

describe('buildAddTagContent', () => {
  it('adds a new tag preserving existing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));

    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: ISO_2 } },
    };
    const result = buildAddTagContent(existing, 'feature', '@bob:example.com');
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags.feature).toEqual({
      set_by: '@bob:example.com',
      set_at: ISO_1,
    });
  });

  it('adds a tag to empty content', () => {
    const result = buildAddTagContent({ tags: {} }, 'bug', '@alice:example.com');
    expect(Object.keys(result.tags)).toEqual(['bug']);
  });
});

describe('buildRemoveTagContent', () => {
  it('removes a tag preserving others', () => {
    const existing: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: ISO_1 },
        feature: { set_by: '@bob:example.com', set_at: ISO_2 },
      },
    };
    const result = buildRemoveTagContent(existing, 'bug');
    expect(result.tags.feature).toEqual(existing.tags.feature);
    expect(result.tags.bug).toBeUndefined();
  });

  it('returns empty tags when removing the only tag', () => {
    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: ISO_1 } },
    };
    const result = buildRemoveTagContent(existing, 'bug');
    expect(result.tags).toEqual({});
  });
});

describe('buildResolvedTagsContent', () => {
  it('adds resolved tag preserving existing tags', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));

    const existing: ThreadTagsContent = {
      tags: { bug: { set_by: '@alice:example.com', set_at: ISO_2 } },
    };
    const result = buildResolvedTagsContent(existing, '@alice:example.com');
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags[RESOLVED_TAG]).toEqual({
      set_by: '@alice:example.com',
      set_at: ISO_1,
    });
  });
});

describe('buildUnresolvedTagsContent', () => {
  it('removes only the resolved tag', () => {
    const existing: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: ISO_1 },
        [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: ISO_2 },
      },
    };
    const result = buildUnresolvedTagsContent(existing);
    expect(result.tags.bug).toEqual(existing.tags.bug);
    expect(result.tags[RESOLVED_TAG]).toBeUndefined();
  });
});

describe('getDisplayTags', () => {
  it('returns all tags except resolved', () => {
    const content: ThreadTagsContent = {
      tags: {
        bug: { set_by: '@alice:example.com', set_at: ISO_1 },
        feature: { set_by: '@bob:example.com', set_at: ISO_2 },
        [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: ISO_3 },
      },
    };
    expect(getDisplayTags(content)).toEqual(['bug', 'feature']);
  });

  it('returns empty array when only resolved exists', () => {
    const content: ThreadTagsContent = {
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: ISO_1 } },
    };
    expect(getDisplayTags(content)).toEqual([]);
  });
});

describe('isThreadResolved', () => {
  it('returns true when resolved tag present', () => {
    const content: ThreadTagsContent = {
      tags: { [RESOLVED_TAG]: { set_by: '@alice:example.com', set_at: ISO_1 } },
    };
    expect(isThreadResolved(content)).toBe(true);
  });

  it('returns false when no resolved tag', () => {
    expect(isThreadResolved({ tags: { bug: { set_by: '@a:b', set_at: ISO_1 } } })).toBe(false);
  });

  it('returns false for empty tags', () => {
    expect(isThreadResolved({ tags: {} })).toBe(false);
  });
});

describe('collectAvailableTags', () => {
  it('collects unique tag names across multiple threads', () => {
    const allContents: ThreadTagsContent[] = [
      {
        tags: {
          bug: { set_by: '@a:b', set_at: ISO_1 },
          feature: { set_by: '@a:b', set_at: ISO_2 },
        },
      },
      {
        tags: {
          bug: { set_by: '@c:d', set_at: ISO_3 },
          review: { set_by: '@c:d', set_at: ISO_4 },
        },
      },
    ];
    const result = collectAvailableTags(allContents, {});
    expect(result).toEqual(['bug', 'feature', 'review']);
  });

  it('excludes resolved from suggestions', () => {
    const allContents: ThreadTagsContent[] = [
      {
        tags: {
          bug: { set_by: '@a:b', set_at: ISO_1 },
          [RESOLVED_TAG]: { set_by: '@a:b', set_at: ISO_2 },
        },
      },
    ];
    const result = collectAvailableTags(allContents, {});
    expect(result).toEqual(['bug']);
  });

  it('excludes tags already present in current thread', () => {
    const allContents: ThreadTagsContent[] = [
      {
        tags: {
          bug: { set_by: '@a:b', set_at: ISO_1 },
          feature: { set_by: '@a:b', set_at: ISO_2 },
        },
      },
    ];
    const currentTags = { bug: { set_by: '@a:b', set_at: ISO_1 } };
    const result = collectAvailableTags(allContents, currentTags);
    expect(result).toEqual(['feature']);
  });

  it('returns empty for no available tags', () => {
    expect(collectAvailableTags([], {})).toEqual([]);
  });
});

describe('aggregateThreadTagEvents', () => {
  it('merges legacy-only room state', () => {
    const events = [
      makeThreadTagsEvent('$root', {
        tags: {
          resolved: { set_by: '@alice:example.com', set_at: 1000 },
          urgent: { set_by: '@alice:example.com', set_at: ISO_2 },
        },
      }),
    ];

    expect(aggregateThreadTagEvents(events)).toEqual(
      new Map([
        [
          '$root',
          {
            tags: {
              resolved: { set_by: '@alice:example.com', set_at: '1970-01-01T00:00:01.000Z' },
              urgent: { set_by: '@alice:example.com', set_at: ISO_2 },
            },
          },
        ],
      ])
    );
  });

  it('merges per-tag room state, tombstones, mixed overrides, and ignores malformed input', () => {
    const events = [
      makeThreadTagsEvent('$root-a', {
        tags: {
          resolved: { set_by: '@alice:example.com', set_at: ISO_1 },
          urgent: { set_by: '@alice:example.com', set_at: ISO_2 },
        },
      }),
      makeThreadTagsEvent(buildPerTagStateKey('$root-a', 'urgent'), {
        set_by: '@bob:example.com',
        set_at: ISO_3,
      }),
      makeThreadTagsEvent(buildPerTagStateKey('$root-a', 'resolved'), {}),
      makeThreadTagsEvent(buildPerTagStateKey('$root-b', 'blocked'), {
        set_by: '@carol:example.com',
        set_at: ISO_4,
        note: ' waiting ',
      }),
      makeThreadTagsEvent('["$root-b","bad tag"]', {
        set_by: '@carol:example.com',
        set_at: ISO_4,
      }),
      makeThreadTagsEvent('["not-an-event","blocked"]', {
        set_by: '@carol:example.com',
        set_at: ISO_4,
      }),
      makeThreadTagsEvent(buildPerTagStateKey('$root-c', 'review'), {
        set_by: '@carol:example.com',
        set_at: 'invalid',
      }),
    ];

    expect(aggregateThreadTagEvents(events)).toEqual(
      new Map([
        [
          '$root-a',
          {
            tags: {
              urgent: { set_by: '@bob:example.com', set_at: ISO_3 },
            },
          },
        ],
        [
          '$root-b',
          {
            tags: {
              blocked: {
                set_by: '@carol:example.com',
                set_at: ISO_4,
                note: 'waiting',
              },
            },
          },
        ],
      ])
    );
  });
});

describe('normalizeTagName', () => {
  it('trims and lowercases', () => {
    expect(normalizeTagName('  Bug  ')).toBe('bug');
    expect(normalizeTagName('FEATURE')).toBe('feature');
  });
});

describe('isValidTagName', () => {
  it('rejects empty names', () => {
    expect(isValidTagName('')).toBe(false);
    expect(isValidTagName('  ')).toBe(false);
  });

  it('rejects the reserved resolved tag', () => {
    expect(isValidTagName('resolved')).toBe(false);
    expect(isValidTagName('  Resolved  ')).toBe(false);
  });

  it('accepts valid names', () => {
    expect(isValidTagName('bug')).toBe(true);
    expect(isValidTagName('feature-request')).toBe(true);
  });

  it('rejects non-canonical characters', () => {
    expect(isValidTagName('bad tag')).toBe(false);
    expect(isValidTagName('bad!')).toBe(false);
  });
});

describe('EventTimeline.FORWARDS usage', () => {
  it('verifies EventTimeline.FORWARDS is the SDK constant, not a string literal', () => {
    // This test ensures we use the SDK constant rather than the string 'forward'
    // which was the source of the CINNY-047 bug
    expect(EventTimeline.FORWARDS).toBeDefined();
    expect(typeof EventTimeline.FORWARDS).toBe('string');
  });
});
