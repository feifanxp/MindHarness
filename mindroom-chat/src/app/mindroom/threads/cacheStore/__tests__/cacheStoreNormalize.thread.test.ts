import { describe, expect, it } from 'vitest';
// CINNY-207 P2.3: pure-helper coverage relocated from the removed
// `threadEventCache.ts` shim; the helpers themselves live in
// `cacheStoreNormalize.ts` / `cacheStoreEvents.ts` and are re-exported
// through the barrel.
import {
  filterPageableCachedThreadEvents,
  getCachedThreadSummaryInfoFromRawEvent,
  getThreadCursorAnchor,
  loadCachedThreadEventsBefore,
  mergeThreadCacheFlag,
  normalizeCachedThreadEvents,
} from '../index';

describe('normalizeCachedThreadEvents', () => {
  it('sorts events chronologically and deduplicates by event id', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '$b', origin_server_ts: 200 },
        { event_id: '$a', origin_server_ts: 100 },
        { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
      ])
    ).toEqual([
      { event_id: '$a', origin_server_ts: 100 },
      { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
    ]);
  });

  it('includes the root event when it is missing from cached replies', () => {
    expect(
      normalizeCachedThreadEvents([{ event_id: '$reply', origin_server_ts: 200 }], {
        event_id: '$root',
        origin_server_ts: 100,
      })
    ).toEqual([
      { event_id: '$root', origin_server_ts: 100 },
      { event_id: '$reply', origin_server_ts: 200 },
    ]);
  });

  it('drops events without usable ids', () => {
    expect(
      normalizeCachedThreadEvents([
        { origin_server_ts: 100 },
        { event_id: '', origin_server_ts: 200 },
        { event_id: '$ok', origin_server_ts: 300 },
      ])
    ).toEqual([{ event_id: '$ok', origin_server_ts: 300 }]);
  });

  it('uses event id as a stable tie-breaker for same-timestamp replies', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '$c', origin_server_ts: 200 },
        { event_id: '$a', origin_server_ts: 200 },
        { event_id: '$b', origin_server_ts: 200 },
      ])
    ).toEqual([
      { event_id: '$a', origin_server_ts: 200 },
      { event_id: '$b', origin_server_ts: 200 },
      { event_id: '$c', origin_server_ts: 200 },
    ]);
  });

  it('deduplicates local echo and confirmed cached thread events by transaction id', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '~local-txn', origin_server_ts: 200, txn_id: 'txn-1' },
        {
          event_id: '$remote-txn',
          origin_server_ts: 200,
          unsigned: { transaction_id: 'txn-1' },
        },
      ])
    ).toEqual([
      {
        event_id: '$remote-txn',
        origin_server_ts: 200,
        unsigned: { transaction_id: 'txn-1' },
      },
    ]);
  });

  it('excludes local echo replies from normalized output', () => {
    expect(
      normalizeCachedThreadEvents([{ event_id: '~!local-only', origin_server_ts: 100 }])
    ).toEqual([]);
  });

  it('excludes local echo replies but keeps confirmed events on cold reload', () => {
    expect(
      normalizeCachedThreadEvents([
        { event_id: '~!local-echo', origin_server_ts: 100 },
        { event_id: '$confirmed', origin_server_ts: 200 },
      ])
    ).toEqual([{ event_id: '$confirmed', origin_server_ts: 200 }]);
  });

  it('excludes local echo rootEvent but keeps confirmed replies', () => {
    expect(
      normalizeCachedThreadEvents([{ event_id: '$reply', origin_server_ts: 200 }], {
        event_id: '~!local-root',
        origin_server_ts: 100,
      })
    ).toEqual([{ event_id: '$reply', origin_server_ts: 200 }]);
  });

  it('deduplicates identical cached remote events when one copy still includes the transaction id', () => {
    expect(
      normalizeCachedThreadEvents([
        {
          event_id: '$remote',
          origin_server_ts: 200,
          unsigned: { transaction_id: 'txn-2' },
        },
        { event_id: '$remote', origin_server_ts: 200 },
      ])
    ).toEqual([{ event_id: '$remote', origin_server_ts: 200 }]);
  });
});

describe('filterPageableCachedThreadEvents', () => {
  it('excludes the thread root from pageable cached replies', () => {
    expect(
      filterPageableCachedThreadEvents(
        [
          { event_id: '$root', origin_server_ts: 100 },
          { event_id: '$reply-1', origin_server_ts: 200 },
          { event_id: '$reply-2', origin_server_ts: 300 },
        ],
        '$root'
      )
    ).toEqual([
      { event_id: '$reply-1', origin_server_ts: 200 },
      { event_id: '$reply-2', origin_server_ts: 300 },
    ]);
  });
});

describe('loadCachedThreadEventsBefore (no-DB fallback)', () => {
  // Kept as a smoke test for the production paginator's undefined-token
  // behavior when IndexedDB is absent — reconcileThreadBackwardPagination
  // preserves the SDK token in that case, which is the safe fallback
  // that avoids overwriting legitimate state.
  const anchor = { eventId: '$anchor', ts: 500 };

  it('returns an empty page with undefined beforeToken when indexedDB is not available', async () => {
    const page = await loadCachedThreadEventsBefore(
      'session',
      '!room:example.org',
      '$thread',
      anchor,
      10
    );
    expect(page.events).toEqual([]);
    expect(page.beforeToken).toBeUndefined();
  });

  it('returns an empty page for any anchor when the DB is unavailable', async () => {
    const page = await loadCachedThreadEventsBefore(
      'session',
      '!room:example.org',
      '$thread',
      { eventId: '$unknown-event', ts: 1 },
      10
    );
    expect(page.events).toEqual([]);
    expect(page.beforeToken).toBeUndefined();
  });
});

describe('filterPageableCachedThreadEvents', () => {
  it('returns all replies for a thread with >80 replies', () => {
    const replies = Array.from({ length: 85 }, (_, i) => ({
      event_id: `$reply-${i}`,
      origin_server_ts: 1000 + i * 100,
    }));
    const allEvents = [{ event_id: '$root', origin_server_ts: 0 }, ...replies];
    const result = filterPageableCachedThreadEvents(allEvents, '$root');
    expect(result).toHaveLength(85);
    expect(result[0].event_id).toBe('$reply-0');
    expect(result[84].event_id).toBe('$reply-84');
  });

  it('returns empty array when thread has only the root event', () => {
    const result = filterPageableCachedThreadEvents(
      [{ event_id: '$root', origin_server_ts: 0 }],
      '$root'
    );
    expect(result).toHaveLength(0);
  });
});

describe('getThreadCursorAnchor', () => {
  it('returns an event id and normalized timestamp anchor', () => {
    expect(
      getThreadCursorAnchor({
        event_id: '$reply',
        origin_server_ts: 123,
      })
    ).toEqual({
      eventId: '$reply',
      ts: 123,
    });
  });

  it('returns undefined for invalid events', () => {
    expect(getThreadCursorAnchor(undefined)).toBeUndefined();
    expect(getThreadCursorAnchor({ origin_server_ts: 10 })).toBeUndefined();
  });

  it('normalizes missing timestamps to zero for pagination anchors', () => {
    expect(
      getThreadCursorAnchor({
        event_id: '$reply',
      })
    ).toEqual({
      eventId: '$reply',
      ts: 0,
    });
  });
});

describe('getCachedThreadSummaryInfoFromRawEvent', () => {
  it.each([false, true])(
    'preserves server chronology from cached events (edited: %s)',
    (edited) => {
      expect(
        getCachedThreadSummaryInfoFromRawEvent({
          origin_server_ts: 1000,
          ...(edited
            ? { unsigned: { 'm.relations': { 'm.replace': { origin_server_ts: 2000 } } } }
            : {}),
          content: {
            body: 'Saved summary',
            msgtype: 'm.notice',
            'io.mindroom.thread_summary': true,
          },
        })
      ).toEqual({ summaryText: 'Saved summary', eventTs: edited ? 2000 : 1000 });
    }
  );

  it('extracts summary info from cached summary events', () => {
    expect(
      getCachedThreadSummaryInfoFromRawEvent({
        content: {
          body: 'Latest summary',
          msgtype: 'm.notice',
          'io.mindroom.thread_summary': true,
        },
      })
    ).toEqual({ summaryText: 'Latest summary' });
  });

  it('returns undefined for non-summary cached events', () => {
    expect(
      getCachedThreadSummaryInfoFromRawEvent({
        content: {
          body: 'Regular message',
          msgtype: 'm.text',
        },
      })
    ).toBeUndefined();
  });
});

describe('mergeThreadCacheFlag', () => {
  it('preserves the current value when the next value is undefined', () => {
    expect(mergeThreadCacheFlag(true, undefined)).toBe(true);
    expect(mergeThreadCacheFlag(false, undefined)).toBe(false);
    expect(mergeThreadCacheFlag(undefined, undefined)).toBeUndefined();
  });

  it('lets an explicit next value replace the current value', () => {
    expect(mergeThreadCacheFlag(true, false)).toBe(false);
    expect(mergeThreadCacheFlag(false, false)).toBe(false);
    expect(mergeThreadCacheFlag(undefined, false)).toBe(false);
    expect(mergeThreadCacheFlag(false, true)).toBe(true);
    expect(mergeThreadCacheFlag(true, true)).toBe(true);
    expect(mergeThreadCacheFlag(undefined, true)).toBe(true);
  });
});
