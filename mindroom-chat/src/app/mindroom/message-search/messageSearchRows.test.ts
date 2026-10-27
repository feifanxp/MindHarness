import { describe, expect, it } from 'vitest';
import { flattenMessageSearchRows, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT } from './messageSearchRows';

describe('flattenMessageSearchRows', () => {
  it('preserves room headers and item ordering', () => {
    const rows = flattenMessageSearchRows([
      {
        roomId: '!a:example.org',
        items: [
          { rank: 1, event: { event_id: '$one' } as never, context: {} as never },
          { rank: 2, event: { event_id: '$two' } as never, context: {} as never },
        ],
      },
      {
        roomId: '!b:example.org',
        items: [{ rank: 3, event: { event_id: '$three' } as never, context: {} as never }],
      },
    ]);

    expect(rows).toEqual([
      { kind: 'room-header', key: 'header:!a:example.org', roomId: '!a:example.org' },
      {
        kind: 'item',
        key: 'item:!a:example.org:$one',
        roomId: '!a:example.org',
        item: { rank: 1, event: { event_id: '$one' }, context: {} },
      },
      {
        kind: 'item',
        key: 'item:!a:example.org:$two',
        roomId: '!a:example.org',
        item: { rank: 2, event: { event_id: '$two' }, context: {} },
      },
      { kind: 'room-header', key: 'header:!b:example.org', roomId: '!b:example.org' },
      {
        kind: 'item',
        key: 'item:!b:example.org:$three',
        roomId: '!b:example.org',
        item: { rank: 3, event: { event_id: '$three' }, context: {} },
      },
    ]);
  });

  it('keeps the fallback row limit bounded', () => {
    expect(MESSAGE_SEARCH_FALLBACK_ROW_LIMIT).toBeGreaterThan(0);
    expect(MESSAGE_SEARCH_FALLBACK_ROW_LIMIT).toBeLessThan(50);
  });
});
