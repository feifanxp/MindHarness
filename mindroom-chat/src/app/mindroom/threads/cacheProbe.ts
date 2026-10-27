/**
 * CINNY-207 P0.1: cache write/read observability probe.
 *
 * Pure counters — no behavior change. Incremented from the IndexedDB cache
 * write paths and readable for debugging/measurement through
 * `window.__MINDROOM_CACHE_PROBE__`. Counters record *attempted* puts
 * (counted before the transaction commits, so an aborted transaction still
 * counts and additionally ticks `writeErrors`). `eventDeletes` is reserved
 * for the P1.2 delete paths. Baselines and acceptance criteria live in
 * docs/mindroom-cache-overhaul-plan.md (AC5 requires IDB writes per live
 * event to be O(1); the probe is how that claim is measured).
 */

export type CacheProbeCounters = {
  // CollapsibleMessage overflow verdicts as they are applied (true =
  // collapses to the capped height, false = renders uncapped). A verdict
  // FLIP on a mounted row is a mid-scroll height change; diagnosable from
  // e2e alongside per-tile height traces.
  collapsibleVerdictOverflowing: number;
  collapsibleVerdictNotOverflowing: number;
  roomSaveCalls: number;
  roomEventPuts: number;
  roomMetaPuts: number;
  threadSaveCalls: number;
  threadEventPuts: number;
  threadMetaPuts: number;
  eventDeletes: number;
  writeErrors: number;
  serializedEvents: number;
  // CINNY-207 P1.4 (AC4 evidence): counts trailing-debounced target upserts
  // fired by the edit-compaction scheduler. Each streaming burst of N edits
  // is expected to produce one increment here rather than N standalone
  // record puts.
  editCompactions: number;
  // Counts compaction fires where the replace target was not in SDK memory
  // and the write fell back to persisting the replace event standalone
  // (durability fallback — a silent drop would otherwise be invisible).
  editCompactionTargetMisses: number;
  // CINNY-207 P3.1 (AC6 evidence): counts live events processed by the
  // client-level MindroomSyncEngine. Bumped once per event delivered to
  // the engine's write-through handler after `liveMode` has flipped true
  // — so IDB-replay and initial-sync-burst events are excluded. A room
  // that is not currently mounted still contributes when its live events
  // arrive, which is the whole point of Tier-1 write-through.
  engineLiveWrites: number;
  // CINNY-207 P3.2 (AC13 evidence): counts gap-fill jobs enqueued by
  // the engine's gap tracker. Bumped once per job — startup jobs on
  // Sync→Prepared per joined room, plus limited-sync jobs on
  // RoomEvent.TimelineReset for the room's unfiltered timelineSet.
  // The Phase 4 executor will drain the queue and clear the marker.
  gapFillsEnqueued: number;
  // CINNY-207 P4.1 (AC8 evidence): BackfillScheduler observability.
  // `schedulerEnqueued` bumps on every accepted enqueue, `schedulerDeduped`
  // on the rejected duplicate (same-key AC8 dedup path), `schedulerAborted`
  // on cooperative abort teardown, `schedulerCompleted` on natural job
  // completion, and `schedulerFailed` on job executor rejection that
  // wasn't caused by an abort (P4 gate fix: silent job failures were
  // invisible from a trace and turned AC13 debugging into guesswork).
  // Together they measure the "no duplicate in-flight jobs per (room,
  // thread, kind)" invariant.
  schedulerEnqueued: number;
  schedulerDeduped: number;
  schedulerAborted: number;
  schedulerCompleted: number;
  schedulerFailed: number;
  // CINNY-207 P5-GATE-FIX (AC2 evidence): reconciler observability.
  // `reconcilesScheduled` bumps once per `scheduleReconcile` call
  // (thread-scope or room-scope), giving a trace the ability to
  // distinguish "the open path never asked for a reconcile" from
  // "the reconciler ran and found nothing to repair" — the same
  // observability lesson as schedulerFailed (P4 gate fix).
  // `reconcilesRepaired` bumps once per pass that actually applied
  // a repair (i.e. detectDivergence returned true and hydration
  // ran); the D7 cheap-no-op path leaves it untouched.
  reconcilesScheduled: number;
  reconcilesRepaired: number;
  // CINNY-207 P5-GATE-FIX v4 (AC2 diagnosis): bumps when the reconciler
  // reached the SDK-injection step with a non-empty mapped batch but
  // `room.getThread(threadId)` returned null. This is the exact
  // complete-coverage cache-first reopen shape team-lead flagged: SDK
  // bootstrap is skipped by design so the thread model does not exist
  // yet, and `liveThread.addEvents(...)` silently no-ops. A repair still
  // runs (hydration + supplemental sink via `onRepaired`) — this counter
  // distinguishes "SDK-only injection worked" from "SDK path no-op'd,
  // convergence relied entirely on the render-fallback leg" in a docker
  // trace without another blind cycle.
  reconcilesThreadNull: number;
  // CINNY-207 P5-GATE-FIX v4 (final iteration — team-lead directive
  // 2026-07-04): definitive evidence that the widened `onRepaired`
  // observer callback returned normally. A shared in-flight repair can notify
  // multiple observers, so this callback count may exceed the repaired-pass
  // count. Throwing callbacks do not increment it.
  reconcilesOnRepairedFired: number;
  // CINNY-207 P5-GATE-FIX v4 (final iteration — team-lead directive
  // 2026-07-04): counts reconciler repair passes that persisted the
  // fetched thread events through the engine snapshot writer after
  // divergence (see `reconciler.ts` for the exact call site). Team-lead's
  // seam analysis: the pre-v4 chain converged in memory (SDK inject +
  // render supplemental sink) but never taught the CACHE about the
  // fetched events — so the next reopen from IDB would re-hit the
  // same stale window and, if the render preference reads
  // `fallbackThreadEventsState.events` before the reconciler's next
  // tick lands, paint v1 again. This counter proves the persist leg
  // fired on the pass that triggered a repair; it complements
  // `threadSaveCalls` (which counts ALL persist paths including live
  // writes) by isolating the reconciler-owned persist.
  reconcilerPersists: number;
  // CINNY-207 AC2 STEP 1 (2026-07-04): distinguishable exit-path
  // counters for `runThreadReconcilePass`. Together with the existing
  // `reconcilesRepaired`, EVERY code path out of the executor increments
  // exactly one counter, so the invariant
  //   reconcilesScheduled ==
  //     reconcilesSignalAborted +
  //     reconcilesFetchFailed + reconcilesNoDivergence +
  //     reconcilesNoRoom +
  //     reconcilesRepaired
  // holds and can be asserted from a docker probe snapshot.
  //
  //   reconcilesSignalAborted: `signal.aborted` was observed (in the
  //     loop or post-loop). The scheduler drove this via
  //     controller.abort — engine teardown / abort() call.
  //   reconcilesFetchFailed: fetchThreadRelationPage returned
  //     undefined (SDK threw) OR the fetch succeeded but the merged
  //     batch was empty (all pages returned empty chunks). Either way
  //     no divergence could be assessed.
  //   reconcilesNoDivergence: fetch produced a non-empty batch, but
  //     detectDivergence returned false — the "cached was right"
  //     zero-cost path (D7 no-op).
  //   reconcilesNoRoom: schedule reached the executor but
  //     `mx.getRoom(roomId)` returned null (rare — room unloaded
  //     between schedule and drain).
  reconcilesSignalAborted: number;
  reconcilesFetchFailed: number;
  reconcilesNoDivergence: number;
  reconcilesNoRoom: number;
  // 2026-07-10 missing-middle fix: bumps each time the reconciler's
  // fetch loop pages PAST a cached-window overlap because the union of
  // known reply ids (cached + fetched so far) still falls short of the
  // authoritative expected reply count. Overlap alone used to be the
  // stop condition, which made a hole BEHIND the cached tail
  // structurally invisible (the tail overlaps on page 1, the pass
  // stops, the middle is never fetched). A nonzero value in a trace
  // proves the shortfall guard is what drove the deeper pages.
  reconcileShortfallPagesPastOverlap: number;
  // CINNY-207 AC2 revision (2026-07-04): pruned to the minimal set that
  // still enforces the post-choke-point invariant. The iter-2 shape had
  // one schedule counter per branch (`threadOpenScheduledCacheFirst`,
  // `threadOpenScheduledLifecycle`) and 12 skip counters, one per early
  // return in the thread-open flow. With the schedule relocated to a
  // single unskippable choke point at the top of `runThreadOpenCacheFirst`
  // (right after the post-hydrate guard), all the branch-schedule
  // counters and post-choke-point skip counters became scaffolding for a
  // shape that no longer exists — pruning them per the product-owner
  // directive ("prune counters that guard now-impossible paths").
  //
  // Post-revision invariant asserted from a docker probe snapshot:
  //
  //   threadOpens ==
  //     threadOpenScheduledCacheFirst +
  //     threadOpenSkipCacheFirstHydrateGuard +
  //     threadOpenSkipCacheFirstPostHydrateGuard
  //
  //   threadOpens: bumps once at the start of the useEffect body for
  //     every open (guarded to skip the no-thread cleanup effect).
  //   threadOpenScheduledCacheFirst: bumps at the single choke-point
  //     schedule call site in `runThreadOpenCacheFirst` (right after
  //     the post-hydrate guard). Kept the historical name for
  //     git-blame continuity, but "cacheFirst" here means "the
  //     choke-point inside runThreadOpenCacheFirst" — there is no
  //     other schedule counter to disambiguate against.
  //   threadOpenSkipCacheFirstHydrateGuard: hydrate threw AND
  //     isCurrentThreadOpen() returned false; the open aborted before
  //     the choke-point could fire. Legitimate — the thread is closed.
  //   threadOpenSkipCacheFirstPostHydrateGuard: post-hydrate
  //     isCurrentThreadOpen() returned false; same shape, same
  //     legitimacy.
  //
  // Every OTHER path through the thread-open flow (the complete-cache
  // fast path, SDK-bootstrap early returns, etc.) occurs AFTER the
  // choke-point schedule fired, so those paths do not need skip
  // counters to prove convergence intent. (The backfill-completed
  // paint-and-return branch this list used to name was deleted by the
  // 2026-07-06 open-path consolidation.)
  threadOpens: number;
  threadOpenScheduledCacheFirst: number;
  threadOpenSkipCacheFirstHydrateGuard: number;
  threadOpenSkipCacheFirstPostHydrateGuard: number;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): sink counters that
  // distinguish the three candidate mechanisms for the render-gap
  // ("engine converges, edit-target v2 never renders"). Each names a
  // specific seam between the reconciler's onRepaired batch and the
  // MatrixEvent instance the render layer actually holds.
  //
  //   onRepairedGuardBailed: reconciler fired onRepaired but the
  //     component-side guard (`isCurrentThreadOpen()`) returned false,
  //     so `setSupplementalThreadEvents` did NOT run for this batch.
  //     Diagnostic for candidate (b) / (c): the repair batch reached
  //     the render seam but was gated out before the sink ran.
  //     For the production thread-open observer,
  //     `reconcilesOnRepairedFired` is bumped after its callback returns, so
  //     the relation
  //     reconcilesOnRepairedFired == onRepairedGuardBailed +
  //       supplementalEventsExecuted + supplementalEventsSkippedEmpty
  //     holds and can be asserted from a probe snapshot.
  //   supplementalEventsExecuted: reconciler's onRepaired ran end to
  //     end and called `setSupplementalThreadEvents(threadId, [...])`.
  //     Diagnostic: sink executed; if v2 still not visible, the gap
  //     is downstream of the fallback state (candidate (a) or (b)).
  //   supplementalEventsSkippedEmpty: onRepaired ran but the repaired
  //     batch was empty, so the sink was intentionally skipped (see
  //     P5-GATE-FIX v3 cost-guarantee test). Kept separate so a docker
  //     trace can distinguish "sink skipped because nothing to sink"
  //     from "sink guarded out".
  onRepairedGuardBailed: number;
  supplementalEventsExecuted: number;
  supplementalEventsSkippedEmpty: number;
  // Task #125 (2026-07-04): bumps once per scroll-driven thread
  // back-pagination auto-fire (the effect in MindroomRoomTimeline that
  // fires the chip pipeline when the rendered window's top edge enters
  // the trigger headroom). Lets the e2e reachability test assert the
  // TRIGGER fired — background band backfill can satisfy the content
  // assertion on fast networks, so without this scalar the e2e cannot
  // distinguish trigger-driven from band-driven loading.
  threadAutoPaginateBackFired: number;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): mergeThreadRenderEvents
  // "edit-relation seen but target's replacingEvent() unchanged"
  // observability. Diagnostic for candidate (b): the merge received an
  // m.replace event but the target instance it kept has no
  // `replacingEvent()` set — i.e. the applier mutated some other
  // instance and this merge is picking the un-repaired copy. See
  // threadRenderUtils.ts `mergeThreadRenderEvents`.
  mergeSawEditRelationNoTargetChange: number;
  // CINNY-207 AC2 render-gap RG2 (2026-07-04): distinguishes
  // hypothesis 1 (merge never receives the edit event) from
  // hypothesis 2 (merge receives it and produces correct output, but
  // downstream render swallows). Bumps once per merge call whose
  // `incomingEvents` contains ANY m.replace event, regardless of
  // whether the target's replacingEvent() is set. If this counter is
  // 0 while supplementalEventsExecuted is >0, the sink fired but the
  // re-render / state propagation is not delivering the incoming
  // batch to the merge — the seam is between the sink and the memo.
  mergeSawIncomingEditRelation: number;
  // CINNY-207 AC2 render-gap RG3 (2026-07-04): observability at the
  // ACTUAL render-pipeline entry point (getEditedEvent in
  // utils/room.ts). Bumps once per getEditedEvent call:
  //
  //   renderTargetHadReplacement: `mEvent.replacingEvent()` returned
  //     a non-null candidate that PASSED the same-sender check and
  //     was included in the candidate edit list.
  //   renderTargetLackedReplacement: `mEvent.replacingEvent()`
  //     returned null.
  //
  // Diagnostic: if `renderTargetHadReplacement` is 0 while merge
  // counter `mergeSawEditRelationNoTargetChange` is also 0 AND the
  // merge saw incoming edits (`mergeSawIncomingEditRelation > 0`),
  // then the merge produced correct output but the RENDER is
  // receiving a DIFFERENT instance for the target — proving the seam
  // between "merge output stored in state" and "render reads state".
  renderTargetHadReplacement: number;
  renderTargetLackedReplacement: number;
  // CINNY-207 AC2 render-gap RG5b (2026-07-04): unconditional applier
  // observability, kept as permanent scalar tripwires after the RG4-era
  // instance-identity classifiers were retired. Together they partition
  // every path out of `applyCachedReplaceRelations`:
  //   applierMakeReplacedFired: bumped once per real makeReplaced call
  //     in the applier (the m.replace was in the batch, sender matched,
  //     latestEdit differed from the current replacement).
  //   applierMakeReplacedNoOpGuardFired: bumped when the guard bailed
  //     out (no candidate edit OR the picked edit equalled the current
  //     replacement). Sub-split into the two mutually exclusive causes
  //     via `applierMakeReplacedNoLatestEdit` (getLatestEdit returned
  //     undefined — every candidate had a sender mismatch) and
  //     `applierMakeReplacedLatestEqualsCurrent` (target already carries
  //     the picked replacement — benign no-op). Invariant:
  //     applierMakeReplacedNoOpGuardFired ==
  //       applierMakeReplacedNoLatestEdit +
  //       applierMakeReplacedLatestEqualsCurrent
  //   applierMakeReplacedNoLatestEdit > 0 names a sender-mismatch shape
  //     (hydration issue or cross-sender edit). Must-stay-0 in a
  //     well-formed corpus.
  applierMakeReplacedFired: number;
  applierMakeReplacedNoOpGuardFired: number;
  applierMakeReplacedNoLatestEdit: number;
  applierMakeReplacedLatestEqualsCurrent: number;
  // CINNY-207 AC2 render-gap RG5d (2026-07-04): permanent WORK counter
  // on the eventMap merge invariant — NOT a must-stay-0 tripwire.
  // `mergeThreadRenderEvents` canonicalizes on write in
  // `setEventForKeys` — when writing an event under its key set, any
  // existing instance reachable under ANY of the incoming keys is
  // displaced from ALL of its map keys before the winner is written
  // under the union. This counter bumps once per losing instance that
  // had to be displaced.
  //
  // Invariant: after `mergeThreadRenderEvents` returns, every event
  // identity in `eventMap` maps to exactly one instance, and that
  // instance is reachable under every key both the winner and any
  // loser held. `Array.from(new Set(eventMap.values()))` (used by both
  // the merge output and any downstream consumer that walks the map)
  // therefore contains one entry per identity, not one per instance.
  //
  // A stable small non-zero reading is HEALTHY, expected dedup work:
  // multiple ingestion paths legitimately deliver distinct instances
  // of the same identity to the sink (reconciler onRepaired payloads,
  // SDK sync/echo deliveries), and dedup across overlapping key sets
  // is exactly the merge's contract. The AC2 live flow reads 3 per
  // run — and still reads 3 with the onRepaired hydrated-view payload
  // reverted, so the duplication is not attributable to any single
  // producer. What warrants investigation is a step-change in the
  // reading (a new duplication source appeared) — not the non-zero
  // itself.
  eventMapCanonicalizedDisplacements: number;
  // CINNY-207 AC2 render-gap RG5c (2026-07-04, re-homed post-F1):
  // permanent MUST-STAY-0 tripwire on the "repaired state is monotonic"
  // picker rule. Bumps once per canonicalization event where at least
  // one displaced loser carried `.replacingEvent() != null` while the
  // chosen winner had `.replacingEvent() == null` — i.e. the picker
  // rule (raw replacement presence must win a same-id tie) was
  // violated at the eventMap merge seam.
  //
  // History: the RG5c cycle originally installed this counter inside
  // `replaceFallbackInstanceRegistry` as a pre-overwrite check on the
  // fallback registry map. The F1 sweep (d5f04e90) removed that
  // registry to close a memory-hazard shape (module-scope Map holding
  // strong MatrixEvent refs, unbounded in prod), which also removed
  // the counter. Per team-lead: the counter itself is a pure scalar
  // and must survive as the permanent alarm on the picker rule.
  // Re-homed at the canonicalization site in
  // `threadRenderUtils.ts::setEventForKeys`, where the same
  // repaired-vs-unrepaired shape now expresses as "loser had
  // replacement, winner does not". No Map, no retained refs, no eager
  // collection — a scalar bump on a shape that
  // `pickPreferredThreadRenderEvent`'s RG5-fix2 rule already
  // guarantees cannot fire.
  //
  // Interpretation: must stay 0. Any non-zero reading is a real
  // regression alarm — the picker preference (raw
  // `.replacingEvent()` presence wins) is being violated somewhere
  // downstream of the picker call or the picker itself has a code
  // path that returns the unrepaired sibling.
  registrySwappedRepairedForUnrepaired: number;
  // Thread back-pagination exit-path observability (2026-07-06, prepend
  // one-paint work). `handleThreadPaginateBack` has several silent
  // no-commit exits; a device/e2e trace must be able to distinguish
  // "cache page committed" / "network page committed" from each bail-out
  // — the same observability lesson as the reconciler exit counters.
  threadPaginateBackCacheCommits: number;
  threadPaginateBackNetworkCommits: number;
  // Cache had nothing older than the rendered window → network leg entered.
  threadPaginateBackCacheMisses: number;
  threadPaginateBackNoThread: number;
  threadPaginateBackNoToken: number;
  threadPaginateBackNetworkErrors: number;
  // Thread switched mid-flight; pagination abandoned.
  threadPaginateBackStaleThreadBails: number;
  // Ledger fold: the reader's anchor row vanished from the render list
  // (redaction/dedup) and the fold re-anchored on the nearest surviving
  // row above it instead of silently skipping the compensation.
  threadPrependFoldAnchorFallback: number;
  // Ledger fold: the anchor AND every row above it vanished — no boundary
  // to diff against; the change landed uncompensated.
  threadPrependFoldAnchorLost: number;
  // Offset-ledger settlement causes. Both counters increment only when
  // the component performs the non-zero cancelling scrollTop write:
  // `ledgerQuiescenceSettles` after a true-rest waiter resolves, and
  // `ledgerBoundarySettles` when the safety guard rebases near an
  // otherwise unreachable content edge. Ride trace v3 samples these
  // scalars per frame so a visually coherent rebase can still be
  // attributed when it cancels native iOS momentum.
  ledgerQuiescenceSettles: number;
  ledgerBoundarySettles: number;
  // Settle write reverted by the platform: the compositor reasserted the
  // pre-settle offset while a touchless scroll session (scrubber /
  // trackpad) still owned the position, and the watchdog restored the
  // fold to the ledger. Healthy reading is 0 on scrollend-capable WebKit
  // (the session-aware waiter defers those settles); a non-zero reading
  // on iOS 26.2+ means a session escaped the scrollend gate.
  ledgerSettleWriteDiscarded: number;
};

const createEmptyCounters = (): CacheProbeCounters => ({
  collapsibleVerdictOverflowing: 0,
  collapsibleVerdictNotOverflowing: 0,
  roomSaveCalls: 0,
  roomEventPuts: 0,
  roomMetaPuts: 0,
  threadSaveCalls: 0,
  threadEventPuts: 0,
  threadMetaPuts: 0,
  eventDeletes: 0,
  writeErrors: 0,
  serializedEvents: 0,
  editCompactions: 0,
  editCompactionTargetMisses: 0,
  engineLiveWrites: 0,
  gapFillsEnqueued: 0,
  schedulerEnqueued: 0,
  schedulerDeduped: 0,
  schedulerAborted: 0,
  schedulerCompleted: 0,
  schedulerFailed: 0,
  reconcilesScheduled: 0,
  reconcilesRepaired: 0,
  reconcilesThreadNull: 0,
  reconcilesOnRepairedFired: 0,
  reconcilerPersists: 0,
  reconcilesSignalAborted: 0,
  reconcileShortfallPagesPastOverlap: 0,
  reconcilesFetchFailed: 0,
  reconcilesNoDivergence: 0,
  reconcilesNoRoom: 0,
  threadOpens: 0,
  threadOpenScheduledCacheFirst: 0,
  threadOpenSkipCacheFirstHydrateGuard: 0,
  threadOpenSkipCacheFirstPostHydrateGuard: 0,
  onRepairedGuardBailed: 0,
  supplementalEventsExecuted: 0,
  supplementalEventsSkippedEmpty: 0,
  threadAutoPaginateBackFired: 0,
  mergeSawEditRelationNoTargetChange: 0,
  mergeSawIncomingEditRelation: 0,
  renderTargetHadReplacement: 0,
  renderTargetLackedReplacement: 0,
  applierMakeReplacedFired: 0,
  applierMakeReplacedNoOpGuardFired: 0,
  applierMakeReplacedNoLatestEdit: 0,
  applierMakeReplacedLatestEqualsCurrent: 0,
  eventMapCanonicalizedDisplacements: 0,
  registrySwappedRepairedForUnrepaired: 0,
  threadPaginateBackCacheCommits: 0,
  threadPaginateBackNetworkCommits: 0,
  threadPaginateBackCacheMisses: 0,
  threadPaginateBackNoThread: 0,
  threadPaginateBackNoToken: 0,
  threadPaginateBackNetworkErrors: 0,
  threadPaginateBackStaleThreadBails: 0,
  threadPrependFoldAnchorFallback: 0,
  threadPrependFoldAnchorLost: 0,
  ledgerQuiescenceSettles: 0,
  ledgerBoundarySettles: 0,
  ledgerSettleWriteDiscarded: 0,
});

let counters = createEmptyCounters();

const HYDRATE_MARK_PREFIX = 'mindroom:cache-hydrate';

export const countCacheProbe = (key: keyof CacheProbeCounters, amount = 1): void => {
  counters[key] += amount;
};

export const getCacheProbeSnapshot = (): CacheProbeCounters => ({ ...counters });

// Allocation-free scalar read for per-animation-frame diagnostics. The
// full snapshot intentionally returns a defensive copy, but cloning the
// whole probe object at 60fps would let the ride recorder manufacture the
// frame-time spikes it exists to attribute.
export const getCacheProbeCounter = (key: keyof CacheProbeCounters): number => counters[key];

export const resetCacheProbe = (): void => {
  counters = createEmptyCounters();
  // Clear the hydrate timeline too, so a reset defines a clean measurement
  // window for both counters and timings.
  if (typeof performance !== 'undefined') {
    performance
      .getEntries()
      .filter((entry) => entry.name.startsWith(HYDRATE_MARK_PREFIX))
      .forEach((entry) => {
        if (entry.entryType === 'measure') performance.clearMeasures(entry.name);
        if (entry.entryType === 'mark') performance.clearMarks(entry.name);
      });
  }
};

export const markCacheHydrateStart = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  performance.mark(`${HYDRATE_MARK_PREFIX}:${scope}:start`);
};

export const markCacheHydrateEnd = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  const start = `${HYDRATE_MARK_PREFIX}:${scope}:start`;
  const end = `${HYDRATE_MARK_PREFIX}:${scope}:end`;
  performance.mark(end);
  try {
    performance.measure(`${HYDRATE_MARK_PREFIX}:${scope}`, start, end);
  } catch {
    // Start mark may be absent when hydration was skipped; measurement is
    // best-effort observability only.
  }
};

export const getCacheHydrateMeasures = (): { name: string; duration: number }[] => {
  if (typeof performance === 'undefined') return [];
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(HYDRATE_MARK_PREFIX))
    .map((entry) => ({ name: entry.name, duration: entry.duration }));
};

type CacheProbeWindow = Window & {
  __MINDROOM_CACHE_PROBE__?: {
    snapshot: () => CacheProbeCounters;
    reset: () => void;
    hydrateMeasures: () => { name: string; duration: number }[];
  };
};

if (typeof window !== 'undefined') {
  (window as CacheProbeWindow).__MINDROOM_CACHE_PROBE__ = {
    snapshot: getCacheProbeSnapshot,
    reset: resetCacheProbe,
    hydrateMeasures: getCacheHydrateMeasures,
  };
}
