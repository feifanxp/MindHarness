import { describe, expect, it } from 'vitest';
import {
  buildThreadCacheCoverage,
  hasThreadCacheBackwardGap,
  hasThreadCacheKnownBackwardStart,
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from './threadCacheCoverage';

describe('threadCacheCoverage', () => {
  it('treats a string backward token as an older-message gap', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 3,
      backwardToken: 'tok',
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    });

    expect(hasThreadCacheBackwardGap(coverage)).toBe(true);
    expect(hasThreadCacheKnownBackwardStart(coverage)).toBe(false);
    expect(shouldShowThreadLoadOlderFromCoverage({ coverage, sdkHasBackwardToken: false })).toBe(
      true
    );
  });

  it('treats an explicit null backward token as known room history start', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 3,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(hasThreadCacheBackwardGap(coverage)).toBe(false);
    expect(hasThreadCacheKnownBackwardStart(coverage)).toBe(true);
    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: true,
      })
    ).toBe(true);
  });

  it('does not accept complete metadata without a usable local snapshot', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 0,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(hasUsableThreadCacheSnapshot({ eventCount: 0, rootPresent: false })).toBe(false);
    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: false,
      })
    ).toBe(false);
  });

  it('treats a count-proven complete snapshot as complete for paint even when relations are unproven (2026-07-06 eager-cache policy)', () => {
    // Sweep-warmed shape: the room deep-history sweep persisted the full
    // reply set (reply-count math proved snapshotComplete at hydrate) and
    // asserted tailLoaded, but no /relations pass ever ran, so
    // relationSnapshotComplete is false. The pre-2026-07-06 policy
    // re-downloaded the ENTIRE thread at open just to prove relations;
    // the choke-point reconcile is the revalidator now (D7: coverage
    // decides paint, never revalidate).
    const coverage = buildThreadCacheCoverage({
      eventCount: 2,
      hasMoreBackward: false,
      relationSnapshotComplete: false,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: true,
      })
    ).toBe(true);
  });

  it('treats a genuinely partial snapshot as incomplete for paint (falls through to the SDK drain)', () => {
    // 2026-07-06 consolidation: the open-time relations-backfill
    // predicate is gone — a partial snapshot paints what it has and the
    // open falls through to SDK bootstrap + refreshLatestThreadSlice,
    // the single fallback drain channel. Coverage only decides PAINT.
    const coverage = buildThreadCacheCoverage({
      eventCount: 2,
      backwardToken: 'tok',
      relationSnapshotComplete: false,
      snapshotComplete: false,
      tailLoaded: true,
    });

    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: true,
      })
    ).toBe(false);
  });

  it('lets the SDK backward token show the load-older affordance even when cache coverage is closed', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 2,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(shouldShowThreadLoadOlderFromCoverage({ coverage, sdkHasBackwardToken: true })).toBe(
      true
    );
  });
});
