import { describe, expect, it } from 'vitest';
// CINNY-207 P2.3: pure-helper coverage relocated from the removed
// `roomEventCache.ts` shim; the helpers themselves live in
// `cacheStoreNormalize.ts` and are re-exported through the barrel.
import { getRoomCursorAnchor, normalizeCachedRoomEvents } from '../index';

describe('normalizeCachedRoomEvents', () => {
  it('sorts events chronologically and deduplicates by event id', () => {
    expect(
      normalizeCachedRoomEvents([
        { event_id: '$b', origin_server_ts: 200 },
        { event_id: '$a', origin_server_ts: 100 },
        { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
      ])
    ).toEqual([
      { event_id: '$a', origin_server_ts: 100 },
      { event_id: '$b', origin_server_ts: 200, content: { body: 'latest' } },
    ]);
  });

  it('drops events without usable ids', () => {
    expect(
      normalizeCachedRoomEvents([
        { origin_server_ts: 100 },
        { event_id: '', origin_server_ts: 200 },
        { event_id: '$ok', origin_server_ts: 300 },
      ])
    ).toEqual([{ event_id: '$ok', origin_server_ts: 300 }]);
  });

  it('excludes local echo events from cached room slices', () => {
    expect(
      normalizeCachedRoomEvents([
        { event_id: '~!room:example.org:txn-1', origin_server_ts: 100 },
        { event_id: '$confirmed', origin_server_ts: 200 },
      ])
    ).toEqual([{ event_id: '$confirmed', origin_server_ts: 200 }]);
  });

  it('uses event id as a stable tie-breaker for same-timestamp events', () => {
    expect(
      normalizeCachedRoomEvents([
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
});

describe('getRoomCursorAnchor', () => {
  it('returns an event id and normalized timestamp anchor', () => {
    expect(
      getRoomCursorAnchor({
        event_id: '$event',
        origin_server_ts: 123,
      })
    ).toEqual({
      eventId: '$event',
      ts: 123,
    });
  });

  it('returns undefined for invalid events', () => {
    expect(getRoomCursorAnchor(undefined)).toBeUndefined();
    expect(getRoomCursorAnchor({ origin_server_ts: 10 })).toBeUndefined();
  });

  it('normalizes missing timestamps to zero', () => {
    expect(
      getRoomCursorAnchor({
        event_id: '$event',
      })
    ).toEqual({
      eventId: '$event',
      ts: 0,
    });
  });
});
