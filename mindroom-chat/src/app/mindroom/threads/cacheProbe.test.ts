import { describe, expect, it, beforeEach } from 'vitest';
import {
  countCacheProbe,
  getCacheProbeCounter,
  getCacheProbeSnapshot,
  markCacheHydrateEnd,
  markCacheHydrateStart,
  resetCacheProbe,
} from './cacheProbe';

describe('cacheProbe', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  it('starts with all counters at zero', () => {
    const snapshot = getCacheProbeSnapshot();
    Object.values(snapshot).forEach((value) => expect(value).toBe(0));
  });

  it('increments counters by one and by amount', () => {
    countCacheProbe('threadSaveCalls');
    countCacheProbe('threadEventPuts', 42);
    countCacheProbe('writeErrors');
    countCacheProbe('writeErrors');

    const snapshot = getCacheProbeSnapshot();
    expect(snapshot.threadSaveCalls).toBe(1);
    expect(snapshot.threadEventPuts).toBe(42);
    expect(snapshot.writeErrors).toBe(2);
    expect(snapshot.roomSaveCalls).toBe(0);
  });

  it('returns an independent snapshot copy', () => {
    countCacheProbe('roomEventPuts', 3);
    const snapshot = getCacheProbeSnapshot();
    countCacheProbe('roomEventPuts', 4);

    expect(snapshot.roomEventPuts).toBe(3);
    expect(getCacheProbeSnapshot().roomEventPuts).toBe(7);
  });

  it('reads one counter without allocating a snapshot', () => {
    countCacheProbe('ledgerBoundarySettles', 3);

    expect(getCacheProbeCounter('ledgerBoundarySettles')).toBe(3);
    expect(getCacheProbeCounter('ledgerQuiescenceSettles')).toBe(0);
  });

  it('resets all counters', () => {
    countCacheProbe('roomMetaPuts', 5);
    resetCacheProbe();
    expect(getCacheProbeSnapshot().roomMetaPuts).toBe(0);
  });

  it('tolerates hydrate end without a start mark', () => {
    expect(() => markCacheHydrateEnd('room')).not.toThrow();
    markCacheHydrateStart('room');
    expect(() => markCacheHydrateEnd('room')).not.toThrow();
  });
});
