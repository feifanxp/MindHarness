/**
 * CINNY-207 P5.1 Commit 2: engine-owned `/relations` fetcher.
 *
 * Migrated from `threads/threadBootstrap.ts`. Every non-reconciler
 * `/relations` backfill path — the P4.4 overview-resume job and the
 * new `'thread-backfill'` scheduler job — now imports this from the
 * engine barrel. Two direct consequences:
 *
 *   - The arch guard for `/relations` boundary tightens: after this
 *     commit, `fetchAllThreadRelations` is DEFINED in engine/ and
 *     IMPORTED only within engine/**. A third caller in `threads/`
 *     trips the guard.
 *
 *   - The two remaining raw `mx.fetchRelations` call sites in
 *     `threads/` (the two limit-50 fallback SDK bootstraps in
 *     `threadOpenSdkBootstrap.ts`) are the ONLY non-engine
 *     `fetchRelations` calls; a separate guard asserts that file's
 *     count is exactly 2. `notifications/readReceipts.ts` uses
 *     `mx.fetchRelations` for a `RelationType.Thread` limit-1 receipt
 *     probe — receipts-domain, not thread-history backfill — and is
 *     explicitly excluded from that guard (see comment there).
 */

import { Direction, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import to from 'await-to-js';

export const MAX_THREAD_FETCH_EVENTS = 5000;
export const MAX_THREAD_FETCH_ITERATIONS = 50;

export type ThreadRelationPageResult = {
  events: MatrixEvent[];
  nextBatchToken: string | undefined;
};

/**
 * Order thread seed events by (ts, event id). Deterministic under
 * federation and same-millisecond bursts — mirrors D12 tiebreak on
 * the write path.
 */
const sortThreadSeedEvents = (events: MatrixEvent[]): MatrixEvent[] =>
  events.sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });

/**
 * Page through `/relations` for a thread, returning the accumulated
 * MatrixEvent list plus the last observed `next_batch` token. Bounded
 * above by MAX_THREAD_FETCH_ITERATIONS / MAX_THREAD_FETCH_EVENTS so a
 * pathological homeserver can't stream tokens indefinitely.
 *
 * `isAborted` is cooperative — the fetch is only cancellable between
 * batches, not mid-request (see cooperative-abort v1 in
 * `backfillScheduler.ts`).
 */
export async function fetchAllThreadRelations(
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  batchSize: number,
  isAborted: () => boolean
): Promise<ThreadRelationPageResult | null> {
  const mapper = mx.getEventMapper();
  const allBatches: MatrixEvent[][] = [];
  let nextBatchToken: string | undefined;
  let totalEventCount = 0;

  for (let iteration = 0; iteration < MAX_THREAD_FETCH_ITERATIONS; iteration += 1) {
    // eslint-disable-next-line no-await-in-loop
    const [err, relData] = await to(
      mx.fetchRelations(roomId, threadId, null, null, {
        dir: Direction.Backward,
        limit: batchSize,
        recurse: true,
        ...(nextBatchToken ? { from: nextBatchToken } : {}),
      })
    );
    if (err || !relData) {
      if (iteration === 0) return null;
      break;
    }
    if (isAborted()) return null;

    const batchEvents = relData.chunk
      .slice()
      .reverse()
      .map((rawEvent) => mapper(rawEvent));
    allBatches.push(batchEvents);
    totalEventCount += batchEvents.length;
    nextBatchToken = relData.next_batch ?? undefined;

    if (!nextBatchToken || totalEventCount >= MAX_THREAD_FETCH_EVENTS) break;
  }

  if (isAborted()) return null;

  const events = sortThreadSeedEvents(allBatches.flat());

  return { events, nextBatchToken };
}
