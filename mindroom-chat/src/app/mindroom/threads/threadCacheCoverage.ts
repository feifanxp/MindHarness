import type { ThreadCacheCoverage } from './types';

type BuildThreadCacheCoverageOptions = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  hasMoreBackward?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
  expectedReplyCount?: number;
};

export const buildThreadCacheCoverage = ({
  eventCount,
  oldestTs,
  newestTs,
  backwardToken,
  hasMoreBackward,
  snapshotComplete,
  relationSnapshotComplete,
  tailLoaded,
  expectedReplyCount,
}: BuildThreadCacheCoverageOptions): ThreadCacheCoverage => ({
  eventCount,
  oldestTs,
  newestTs,
  backwardToken,
  hasMoreBackward: hasMoreBackward ?? (typeof backwardToken === 'string' ? true : undefined),
  snapshotComplete,
  relationSnapshotComplete: relationSnapshotComplete === true,
  tailLoaded: tailLoaded === true,
  expectedReplyCount,
});

export const hasThreadCacheBackwardGap = (coverage: ThreadCacheCoverage): boolean =>
  coverage.hasMoreBackward === true || typeof coverage.backwardToken === 'string';

export const hasThreadCacheKnownBackwardStart = (coverage: ThreadCacheCoverage): boolean =>
  coverage.hasMoreBackward === false || coverage.backwardToken === null;

export const hasUsableThreadCacheSnapshot = ({
  eventCount,
  rootPresent,
}: {
  eventCount: number;
  rootPresent: boolean;
}): boolean => eventCount > 0 || rootPresent;

/**
 * 2026-07-06 eager-cache policy: `relationSnapshotComplete` is NOT
 * required for open-time completeness. It is only provable by a full
 * `/relations` drain, so requiring it forced every thread warmed by the
 * room deep-history sweep (Step A — count-proven complete, tail loaded)
 * to re-download its entire history at open just to prove relations.
 * A reply-count-proven `snapshotComplete` + `tailLoaded` + a known
 * backward start is complete for PAINT; divergence (missed edits,
 * redactions, reactions the sweep could not attribute) is the
 * choke-point reconcile's job — D7: coverage decides paint, never
 * revalidation. The flag itself is still tracked/persisted: the prewarm
 * band uses it to decide which threads get a background proving fetch.
 */
export const isCompleteThreadCacheCoverage = ({
  coverage,
  hasLocalSnapshot,
}: {
  coverage: ThreadCacheCoverage;
  hasLocalSnapshot: boolean;
}): boolean =>
  hasLocalSnapshot &&
  coverage.snapshotComplete === true &&
  coverage.tailLoaded &&
  hasThreadCacheKnownBackwardStart(coverage);

export const shouldShowThreadLoadOlderFromCoverage = ({
  coverage,
  sdkHasBackwardToken,
}: {
  coverage: ThreadCacheCoverage;
  sdkHasBackwardToken: boolean;
}): boolean => sdkHasBackwardToken || hasThreadCacheBackwardGap(coverage);
