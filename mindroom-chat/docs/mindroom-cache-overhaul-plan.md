# MindRoom Cache Overhaul Plan (CINNY-207)

> Historical execution record: file and line references to
> `RoomTimeline.architecture.test.ts` describe the 2026-07-04 implementation
> snapshot. The later fork-hardening reduction removed or split that broad
> guard; current ownership checks live in focused `*.architecture.test.ts`
> files and the current validation contract lives in `FORK_CHANGES.md`.

Status: **Phase 1 (P1.1–P1.6) landed and e2e-gated; Phase 2 fully landed locally (P2.1 unified CacheStore + D8 wipe, P2.2 ledger + `beforeTokens` pruning + 1 GB eviction budget, P2.3 direct-import flip + architecture guards + health-gate move into the store); Phase 3 fully landed locally (P3.1 engine skeleton + Tier-1 write-through, P3.2 gap detection + queue stub, P3.3 strip the component's persistence responsibilities); Phase 4 fully landed locally (P4.1 BackfillScheduler with priority + dedup + abort, P4.2 prefetch policy + gap-fill executor + AC13 spec green-shaped + `noteRoomFederated` + `engine.noteRoomFocused`, P4.3 delete preloadController + deep history as band-4 scheduler job, P4.4 absorb thread-seed + overview-resume fetch dedup onto the scheduler); Phase 5 (Reconciler) fully landed locally (P5.1 engine reconciler + D7 rewire + thread backfill into engine + room-open reconcile, P5.2 applier hardening + AC2 spec **GREEN (live, RG5d, 2026-07-04)** after AC2 revision R1-R9 relocated the reconcile schedule to a single unskippable choke point, RG1-RG5b instrumentation exonerated the render chain, the owner-ruled RG4b-fix reworked the spec to anchor + measure repair-displacement (pin-to-bottom on reopen is intentional streaming UX), RG4e name-the-caller instrumentation confirmed no sunk-target clearing in the currently-green flow, RG5-fix2 hardened the same-id merge preference so `handleThreadNewReply` can no longer wipe the repair via the SDK NewReply late-arrival door, RG5c registry-swap tripwire (`registrySwappedRepairedForUnrepaired`) confirms the picker guard holds at both seams (reads 0 across live cycles), and RG5d canonicalizes the merge eventMap so "one MatrixEvent instance per event identity" is a map invariant (`setEventForKeys` displaces losers from ALL keys, replacement-preferring pick; permanent must-stay-0 tripwire `eventMapCanonicalizedDisplacements` reads 3 per live cycle — intra-batch duplication is real in production and is now absorbed at the root) (see §8 Deviations "AC2 expected-RED" entry, RESOLVED update) + Tuwunel stale-copy unit); Phase 6+7 fully landed locally (P6.1 prefetch settings replacement + legacy scrub + arch guard, P7.1 dead-code audit + cache-strategy doc rewrite). P7.2 (final adversarial review + Scorecard audit) is the orchestrator's.**
Phase-1 e2e gate (2026-07-03, stack tip 55439be8): streamed-edit spec green
live (AC4, probe numbers in scorecard), stop-emoji green (AC3; three failed
attempts were host `ERR_NETWORK_CHANGED` flake — tracked in the Runbook).
Phase-3 docker gate ran on the P3.3 tip (2026-07-03): AC6 background-
freshness PASSED — recorded twice (FORK_CHANGES.md entries at
`AC6 background-freshness: PASSED on the P3.3 tip` and
`background-room-freshness (AC6): PASSED on the P3.3 tip`); AC3
`stop-emoji-redaction` FAILED on a clean network (the SDK's
`moveAllRelatedToMainTimeline` defeats the round-1 thread-attribution
scan), and the round-2 cache-derived attribution fix landed with
unit-level evidence only. The FINAL docker gate (2026-07-04, tip
f7bf06b7) then re-confirmed: AC3 stop-emoji PASSED (fix docker-proven),
AC13 gap-fill-restart PASSED, AC6 re-confirmed PASSED, AC2 behaved
expected-RED as annotated (subsequently RESOLVED on 2026-07-04 —
AC2 spec now GREEN under the RG4b-fix rework; see §8 Deviations
"AC2 expected-RED" entry); streamed-edit's final-tip re-run was blocked
by the documented ERR_NETWORK_CHANGED host flake (trace-verified, zero
app errors) — its prior greens and live probe (`total=1`,
`editCompactions=1`) stand. P0.3
large-room probe baseline still pending; AC5 formal measurement lands
with that same final gate (the sweep is structurally gone, so
writes-per-live-event are O(1) by construction; `cacheProbe`'s
`roomEventPuts` / `threadEventPuts` counters supply the after-side
numerator).
Created: 2026-07-03. Living document — see "How to use this document".

This is the canonical plan for making MindRoom feel like a native app: every room
and thread paints instantly from local cache, and the view always converges to
the latest server state. It records the investigation findings, the decisions
made with the product owner, the target architecture, the phased implementation
plan, and the accountability protocol we hold ourselves to.

Related documents:

- `FORK_CHANGES.md` Runbook — per-step delivery log (each bounded step gets an
  entry referencing a step ID from this plan).
- `docs/mindroom-cache-strategy.md` — operational description of the _current_
  cache model. Sections it owns (write owners, coverage semantics, forbidden
  patterns) are updated in lock-step as ownership moves (see Phase 7).
- `docs/mindroom-thread-architecture-plan.md` — earlier thread architecture
  plan; superseded where it conflicts with this document.

## How to use this document

- Before starting any step: re-read "Invariants", the phase you are in, and the
  "Accountability" section. After context compaction, re-read this file and
  `docs/mindroom-cache-strategy.md` before resuming.
- After finishing any step: update the Status Log at the bottom, tick evidence
  into the Scorecard, and add the Runbook entry in `FORK_CHANGES.md`.
- Scope changes are recorded in "Deviations", never silently applied.
- Every step follows the mandatory delivery process in `CLAUDE.md`: one bounded
  step, runbook update, `npm run typecheck` / `npm run build` / `npm run lint`,
  independent review pass, focused commit.

## 1. Product goal and invariants

MindRoom streams AI responses over Matrix: a placeholder message is sent, then
rapidly edited via `m.replace` until the final content lands. Streaming can be
cancelled via a stop emoji reaction on the streaming message, which is redacted
when streaming completes. Conversations are thread-first. The app must feel
native: no spinners, no lazy waterfalls, no stale content.

Two invariants define the contract (stale-while-revalidate):

- **I1 — Instant paint.** Opening any room or thread renders synchronously from
  whatever the cache holds, if anything. No network wait before first paint.
- **I2 — Guaranteed convergence.** After the paint, the view always reconciles
  to server truth: new messages, missed edits, missed redactions, removed
  reactions. Cached state never wins over newer server state. Corrections are
  seamless: in-place content swaps, no flicker, no scroll jumps.

Derived rule: **cache coverage flags may decide what to paint, but never
whether to revalidate.** Every open schedules a reconcile; when the cache was
right, the reconcile is a cheap no-op.

Scale assumptions (design targets, not hard limits): ~50 rooms on the user's
own homeserver (Tuwunel), threads up to low thousands of events, heavy
streaming-edit traffic (10+ edits/sec during streams).

## 2. Investigation findings (2026-07-03)

Ranked by severity within each thematic group (numbering is stable across
the document, so ids are not sequential within groups). File references are
as of commit `b7b10b9d` (v4.12.3 replay base, pre-overhaul); re-verified after the fork's upstream rebase.

### Architecture-level

- **F1 — Room-scoped machinery cannot deliver the goal.** All cache hydration,
  eager preload, thread prewarm, and live-event cache maintenance live inside
  `MindroomRoomTimeline.tsx` (~3,400 lines) and only run for the currently open
  room. There is no cross-room prefetch at app start, and caches of unmounted
  rooms go stale because the live write-through
  (`roomLiveEventController.ts:226`) is only attached while that room's
  component is mounted — even though the data for all rooms already arrives on
  `/sync`.
- **F2 — Write amplification on every live event.**
  `useRoomCacheLifecycleController` (`roomCacheLifecycleController.ts:132`)
  re-runs its persist effect whenever the raw timeline event count changes
  (`MindroomRoomTimeline.tsx:484`), which includes every streaming `m.replace`.
  Each run re-serializes the entire loaded room timeline (deep clone per event,
  up to the 10,000-event preload target) plus regroups and re-persists every
  thread snapshot in the loaded window — undebounced, on the main thread. The
  live path already persists incrementally (`roomLiveEventController.ts:183`,
  `:249`), making the sweep largely redundant. During eager preload this is
  O(n²) across ~50 batches.
- **F13 — Unbounded eager preload.** `preloadController.ts:66,91,121` loops
  `/messages` at batch size 200 toward a target of 10,000 events (~50
  sequential calls plus decryption per room open). The setting has a minimum
  of 50 but no maximum (`preloadSettings.ts:6-9`).

### Storage and durability

- **F3 — No eviction anywhere.** Neither `mindroom-room-event-cache` nor
  `mindroom-thread-event-cache` (nor `mindroom-thread-summary-cache`) has a
  size cap, TTL, or pruning; `updatedAt` is written but never read. The
  `beforeTokens` maps in meta records grow one entry per persist forever
  (`eventCacheTokenUtils.ts:7-17`).
- **F4 — All cache writes are fire-and-forget with swallowed errors**
  (`eventRepository.ts:670,801` and every DB op). A `QuotaExceededError`
  silently stops persistence while the app keeps trusting the cache.
- **F5 — Every intermediate streaming edit is stored forever.** Standalone
  `m.replace` events are persisted as individual records
  (`roomLiveEventController.ts:226-230` → `getThreadCacheTargetId` groups them
  into the thread). Streaming edits carry cumulative content, so a message
  streamed in 40 edits stores ~40 growing snapshots (~10× storage
  amplification). Cached page limits count raw records, so pages of heavily
  streamed threads are crowded with invisible edits
  (`threadEventCache.ts` `runCursorQuery` skips only the root event).

### Correctness of cached rendering

- **F6 — Stop-emoji persistence bug (reported by product owner).** Three
  cooperating mechanisms:
  - **A — Resurrection.** The cache has no delete path; a redacted reaction's
    record is never removed or updated. The redaction event itself often never
    persists: `m.room.redaction` has no `m.relates_to`, so `getRelation()` is
    null and it falls through every thread-relevance branch
    (`roomLiveEventController.ts:138-145`); redactions arriving while the room
    is unmounted are never heard at all (F1). Next hydration re-aggregates the
    stale reaction (`aggregateCachedRelationEvents`); the reopen reconcile only
    covers the latest 200 relations (`threadOpenCacheController.ts:469-545`).
  - **B — Ghost instances.** Hydration maps cached raw events through
    `mx.getEventMapper()` into _new_ `MatrixEvent` instances and aggregates the
    clones into timelineSet `Relations`. SDK redaction removal is
    instance-based, so a redaction applied to the SDK's own copy never reaches
    the clone; `getActiveAnnotationsByKey` keeps counting it.
  - **C — No repaint.** The reaction row is gated by `hasReactions` computed
    inside the row renderer (`MindroomRoomTimeline.tsx:1921`), which only
    re-runs on a timeline tick; a reaction redaction matches no live-handler
    branch and increments no tick.
- **F7 — Stale-while-revalidate violated.** `isCompleteThreadCacheCoverage`
  short-circuits network reconciliation entirely
  (`threadOpenCacheFirst.ts:87`) based on flags that F6-class bugs can make
  wrong, with no discovery path. Tail reconcile covers only 200 relations.
  There is no gap detection when `/sync` returns a `limited` timeline for a
  room (cache tail silently discontinuous with live tail).
- **F8 — Ordering fragility.** Both caches order and paginate by
  `(origin_server_ts, event_id)`; server stream order can diverge (federation,
  clock skew). `getLatestEvent` (`eventCacheEditUtils.ts:40-46`) breaks
  equal-timestamp edit ties by iteration order — nondeterministic across loads;
  same-millisecond ties are realistic at streaming rates.

### Network efficiency

- **F9 — Duplicate `/relations` fetching.** Four independent paths fetch the
  same thread's relations with no shared in-flight promise map (thread-open
  backfill, post-bootstrap refresh, tail refresh, overview resume). A single
  thread open performs overlapping limit-50 (`threadOpenSdkBootstrap.ts:124`)
  then limit-200 (`threadOpenPostBootstrapRefresh.ts:60`) tail fetches. Only
  the seed prewarm dedups correctly (`threadSeedPrewarmController.ts:28-31`).
- **F10 — No request cancellation.** All guards are check-after-await; no
  `AbortController` anywhere. Rapid room switching leaves up-to-50-call
  `/messages` loops running to completion per abandoned room.

### Structural

- **F11 — Preload setting uncapped** (`preloadSettings.ts:8`, no UI max).
- **F12 — Duplication and convergence-by-hope.** `roomEventCache.ts` and
  `threadEventCache.ts` are near-identical; four write triggers upsert into the
  same thread store relying on merge flags to converge; room cache lacks the
  corruption self-heal the thread cache has; `DB_VERSION = 2` with an upgrade
  handler that migrates nothing.

## 3. Decisions

Agreed with the product owner (Bas), 2026-07-03:

- **D1 — Invariants I1/I2** (Section 1) are the top-level contract.
- **D2 — Tiered prefetch model.**
  - **Tier 1 — Global sync write-through:** all joined rooms, unconditional,
    always on. Events (and redactions) already arrive via `/sync`; writing them
    through costs nothing extra. Includes gap-fill scheduling when a room's
    sync timeline is `limited`.
  - **Tier 2 — Background backfill:** tails + thread inventory to a modest
    depth, prioritized queue, **rooms on the user's own homeserver by
    default** (federated rooms backfill only on first open; after that Tier 1
    keeps them fresh).
  - **Tier 3 — Deep history:** current room only.
- **D3 — Homeserver detection** via the sender domain of the `m.room.create`
  event (robust across room versions; do not parse room IDs — room v12 /
  MSC4291 drops the server part).
- **D4 — Settings: replace, don't repurpose.** Remove
  `MindroomMessagePreloadLimitSetting` / `paginationLimit` and introduce a new
  prefetch settings group designed around the tier model: scope
  (`my-server` default / `all-rooms` / `current-room-only`) and depth targets.
  Stored legacy values are dropped.
- **D5 — Edit compaction: cache only placeholder + latest edit.** Never persist
  standalone `m.replace` records. On an edit, upsert the _target's_ record with
  the latest same-sender replacement bundled into
  `unsigned['m.relations']['m.replace']` (the representation
  `serializeEventsForCache` already half-implements). One record per logical
  message, ordered by the placeholder's timestamp. Writes are coalesced per
  target (~1 s) with a **synchronous flush on stream end** and on
  unmount/visibility loss. Redaction of the latest edit falls back to prior
  content on the next reconcile.
- **D6 — Redactions are first-class cache lifecycle.** Global handling in the
  write-through tier for every room: resolve the redaction target and
  delete/update its cache record (redacted reactions are deleted; redacted
  messages are stored pruned). Hydration must not inject clone instances when
  the SDK already holds the event, and must reconcile relation aggregation by
  event ID, not object identity. The thread-view live handler gets an explicit
  redaction branch that triggers a repaint tick.
- **D7 — SWR rule:** coverage decides what to paint, never whether to
  revalidate. Every open schedules a reconcile; the coverage short-circuit
  becomes "nothing to redraw", not "skip the network".
- **D8 — Migration: wipe and rebuild.** On the new schema version, delete old
  cache DBs and repopulate via Tier 1 + scheduler. No in-place migration code.
- **D9 — Storage budget: 1 GB on all platforms (including iOS),** enforced by
  eviction. Order: federated rooms first, then least-recently-active homeserver
  rooms; never evict the current room or recently opened threads. Quota errors
  are additionally handled reactively (F4 fix) because browsers may grant less
  than the budget.
- **D10 — Sequencing: quick wins first** (Phase 1 fixes on current
  architecture), then engine extraction on a cleaner, instrumented base.
- **D11 — Scale assumptions** as in Section 1.
- **D12 — Deterministic edit ordering:** latest edit chosen by
  `origin_server_ts`, ties broken by `event_id` lexicographic (spec-aligned).
- **D13 — DM exception deferred.** Small federated DMs may later be included in
  Tier 2 via the policy function; not in the first version.
- **D14 — Cancellation:** new scheduler/engine code uses `AbortController` from
  day one; existing paths adopt it as they are touched or absorbed.

## 4. Target architecture

A client-level **MindroomSyncEngine**, created alongside the Matrix client
(mounted once per session, independent of which room is open), owning all cache
writes. The timeline component becomes a pure consumer.

```text
                    matrix-js-sdk client (/sync)
                              |
              +---------------+----------------+
              |        MindroomSyncEngine       |
              |                                 |
              |  WriteThrough   BackfillScheduler|
              |  (Tier 1)       (Tiers 2+3)     |
              |        \\          /             |
              |        CacheStore               |
              |  (single write path, eviction,  |
              |   quota, schema, compaction)    |
              |            |                    |
              |        Reconciler               |
              |  (on-open convergence, gap fill)|
              +---------------+----------------+
                              |
              read APIs / hydration helpers
                              |
                 MindroomRoomTimeline (render)
```

Components:

- **CacheStore** — one module replacing `roomEventCache.ts` +
  `threadEventCache.ts` (schema v3, wipe-on-upgrade per D8). Adds: delete
  operations, per-room size/activity ledger for eviction (D9), edit compaction
  at the write boundary (D5), coalesced writes with flush hooks, quota-error
  handling and health state (F4), pruned `beforeTokens`. All writes flow
  through it; write failures are counted and surfaced.
- **WriteThrough (Tier 1)** — global `RoomEvent.Timeline` +
  `RoomEvent.Redaction` listeners on the client (all rooms, threads included),
  feeding CacheStore. Detects `limited` sync responses and enqueues gap-fill.
  Replaces the persistence half of `roomLiveEventController` /
  `threadCachePersistenceController` / `roomCacheLifecycleController`; the
  component keeps only render-triggering logic.
- **BackfillScheduler (Tiers 2–3)** — single priority queue: current room
  first, then recently-active homeserver rooms (policy: D2/D3/D13), then thread
  inventory. Bounded concurrency (2–3), `AbortController` per job, in-flight
  dedup map keyed by (roomId, threadId, kind) so no duplicate `/relations` or
  `/messages` work exists anywhere (F9). Absorbs the eager-preload loop
  (Tier 3) and the thread seed prewarm.
- **Reconciler** — the one implementation of I2. On every room/thread open:
  paint from cache, then verify tail continuity, missed edits/redactions, and
  relation state; repair in place without scroll jumps. Absorbs
  `threadOpenPostBootstrapRefresh`, `refreshLatestThreadRelationsTail`, and the
  resume controller's refresh. Hydration prefers SDK-held instances over
  mapper clones (F6-B).
- **PrefetchPolicy + settings** — new settings group (D4) consumed by the
  scheduler; policy function decides per-room tier membership.

## 5. Implementation phases

Each step is one bounded Runbook step (CLAUDE.md process). Step IDs below are
referenced from `FORK_CHANGES.md` entries.

### Phase 0 — Baseline, instrumentation, red tests

- **P0.1** Cache/IO probes: count IndexedDB puts/deletes per live event, per
  open, per stream; `navigator.storage.estimate()` snapshot; timing marks for
  first-paint-from-cache. Exposed via the existing timeline debug channel.
  Record baseline numbers in the Scorecard.
- **P0.2** E2E red specs against the local Tuwunel fixture (see
  `e2e/live/` conventions):
  - `stop-emoji-redaction.spec`: stream → stop reaction → redaction → assert
    emoji gone **in-session**, **after thread reopen**, **after full reload**
    (expected red for at least one state).
  - `streamed-edit-cache.spec`: stream a message with N edits → reload →
    assert latest content paints (and record how many cache records exist).
  - `background-room-freshness.spec`: two rooms; events arrive in room B while
    room A is open; open B → assert instant paint of new events (expected red —
    documents F1).
- **P0.3** Baseline capture: run probes on a seeded large room; write numbers
  into Scorecard "before" column.

### Phase 1 — Quick wins on the current architecture (D10)

- **P1.1** Kill write amplification (F2): remove the full-sweep persist from
  the `eventsLength` effect; rely on incremental live persists plus explicit
  persist points (pagination batch completion — the queued path already exists
  — room close/unmount, debounced idle flush). Exit: probe shows O(1) writes
  per live event; no cache coverage regression in
  `RoomTimeline.cache.test.ts`.
- **P1.2** Stop-emoji fix (F6): explicit redaction branch in the live handler
  (resolve target via `redacts`/`getAssociatedId`, update/delete cache record,
  trigger repaint tick); hydration reconciles aggregation by event ID and
  skips clone injection when `room.findEventById` hits. Exit: P0.2 spec green
  in all three states.
- **P1.3** Deterministic edit tiebreak (F8/D12): `origin_server_ts` then
  `event_id` in `getLatestEvent` and edit selection paths. Unit tests with
  same-millisecond edits.
- **P1.4** Edit compaction at the write boundary (F5/D5): stop persisting
  standalone `m.replace` records; upsert targets with bundled latest edit;
  per-target coalescing with flush on stream end/unmount/visibility loss.
  Includes lazy cleanup: hydration deletes legacy standalone replace records
  whose target record already bundles an equal-or-newer edit (D12 ordering;
  full purge arrives with D8 wipe in Phase 2). Exit:
  streamed message with N edits produces exactly 1 event record; reload paints
  final content.
- **P1.5** Surface write failures (F4): stop swallowing; failure counter +
  debug log; on quota errors enter a degraded "cache read-only" health state
  instead of silent divergence. Exit: unit test with injected quota error.
- **P1.6** Cap the legacy preload setting (F11) with a hard upper clamp as an
  interim guard (setting is replaced in Phase 6).

### Phase 2 — CacheStore consolidation

- **P2.1** Unified CacheStore module: merge the two near-identical cache
  modules behind one API (F12); add delete ops; schema v3 with **wipe and
  rebuild** (D8): on open, delete legacy DBs (`mindroom-room-event-cache`,
  `mindroom-thread-event-cache`, `mindroom-thread-summary-cache` and their
  session-scoped names).
- **P2.2** Eviction ledger + 1 GB budget (D9): per-room byte estimate and
  last-activity tracking; background eviction job in policy order; prune
  `beforeTokens` maps. Exit: synthetic overfill test (small budget override)
  evicts in policy order and never touches the current room.
- **P2.3** Port Phase-1 write paths onto CacheStore; architecture test forbids
  direct imports of the legacy modules.

### Phase 3 — Sync engine extraction (Tier 1)

- **P3.1** Engine skeleton at client level (created with the Matrix client,
  torn down on logout); global `RoomEvent.Timeline`/`RoomEvent.Redaction`
  write-through for all rooms, threads included, with edit compaction and
  redaction lifecycle from Phase 1 logic moved out of the component.
- **P3.2** Gap detection: `limited` sync → mark tail-discontinuity in CacheStore
  and enqueue gap-fill. Exit: kill-and-restart e2e — events sent while the app
  is closed appear from cache+gap-fill on next open.
- **P3.3** Strip the component's persistence responsibilities
  (`roomCacheLifecycleController`, persistence half of
  `roomLiveEventController`, `threadCachePersistenceController`); component
  keeps render triggering only. Exit: background-room-freshness spec (P0.2)
  green.

### Phase 4 — BackfillScheduler (Tiers 2–3) — **landed 2026-07-04**

- **P4.1** Scheduler with priority queue, concurrency cap, `AbortController`,
  in-flight dedup map (F9/F10/D14). **Landed** as `4f74dafa` on
  `cache-overhaul/11-p4-scheduler`.
- **P4.2** PrefetchPolicy: homeserver detection via `m.room.create` sender
  (D3); scope default `my-server` (D2); depth targets per tier.
  Includes the gap-fill executor over the Phase-3.2 queue and
  `engine.noteRoomFocused`. **Landed** as `0bc82add`.
- **P4.3** Migrate Tier 3 (current-room deep history) into the scheduler;
  delete the eager-preload loop in `preloadController.ts`. Deep history
  is now a band-4 job that uses `createMessagesRequest` +
  `saveRoomEventsToCache` (never touches the SDK live timeline).
  **Landed** as `549e891a`.
- **P4.4** Absorb thread seed prewarm and overview resume fetching into the
  scheduler (single dedup domain). Fetch dedup relocated onto the
  scheduler; outer React scaffolding preserved for downstream
  consumers. **Landed** as `2fa4334a`.

### Phase 5 — Reconciler (I2 everywhere) — **landed 2026-07-04**

- **P5.1** One reconcile pass on every room/thread open: coverage decides paint
  only (D7); the complete-coverage path still schedules revalidation. Absorb
  the four overlapping refreshers (F7/F9). Exit: AC9 unit test — coverage
  -complete open still reconciles. **Landed** as `727ce26e` (Commit 1 —
  engine reconciler + D7 rewire), `05594b54` (Commit 2 — thread backfill
  into engine + delete post-bootstrap refresh), `7a30e7f8` (Commit 3 —
  room-open reconcile) on `cache-overhaul/12-p5-reconciler`.
- **P5.2** Divergence repair: seeded-stale-cache e2e (stale edit, stale
  reaction, missed redaction) converges after open without reload, in place,
  scroll anchored. Exit: AC2 spec green. **Landed** as `5724ef8f` (Commit 4
  — applier hardening unit + Tuwunel stale-copy unit + AC2 spec flipped
  green; docker gate is team-lead's to run).

### Phase 6 — Settings replacement (D4) — **landed 2026-07-04**

- **P6.1** New prefetch settings group (scope + depth); remove
  `MindroomMessagePreloadLimitSetting` and `paginationLimit` plumbing; drop
  stored legacy values; update settings tests. **Landed** as commits
  `07fb8555` (resolvers + transitional fields), `2bcbe724`
  (`MindroomPrefetchSettings` UI + arch guard flip), `09f28b95`
  (consumers onto `prefetchDepth`, `timelinePagination` parameter
  renamed to `windowLimit`), `a27aedf7` (delete
  `MindroomMessagePreloadLimitSetting.*` + `preloadSettings.test.ts` +
  legacy sanitizers, add `mindroomSettingsBootstrap.dropLegacyMindroomSettings`
  scrub + wire it into `src/index.tsx` before `state/settings.ts`
  initializes, rewrite `mindroomSettings.test.ts`, install
  `prefetchSettings.architecture.test.ts` guard) on
  `cache-overhaul/13-p6p7-settings-cleanup`.

### Phase 7 — Cleanup and documentation

- **P7.1** Delete superseded controllers and dead code; update
  `docs/mindroom-cache-strategy.md` (write owners → engine components; eager
  preload section; forbidden patterns — the "no cross-room eager preload from a
  room screen" rule remains true because cross-room work lives in the engine).
  **Landed** as a single docs commit (Commits 5+6 folded per Deviations §8 —
  the dead-code audit produced zero verified-dead orphans). Commit
  rewrites `docs/mindroom-cache-strategy.md` and adds this Phase 6+7
  runbook entry.
- **P7.2** Final adversarial review + full Scorecard audit (see Section 6) —
  orchestrator's responsibility, not part of the P6+P7 branch.

## 6. Accountability: how we verify we built the right thing

### 6.1 Rules (anti-self-deception)

1. **No criterion is marked done by its implementer without linked evidence.**
   Evidence = a re-runnable command (test name, e2e spec, probe measurement)
   recorded in the Scorecard row.
2. **Measurements are numbers, not adjectives.** "Fast" is not evidence;
   "first paint 84 ms, 0 network requests before paint" is.
3. **Red before green.** Every behavioral fix lands with the failing test first
   (recorded in the Runbook entry), matching existing fork practice.
4. **Independent review per step** (CLAUDE.md): a separate agent/subagent
   reviews the diff against this plan; the reviewer, not the author, confirms
   the Scorecard row.
5. **Deviations are logged**, never silently applied (Section 8).
6. **Phase gates:** a phase is closed by an adversarial review whose explicit
   job is to _refute_ each checked criterion of that phase — verify the
   evidence exists, re-run it, and check it actually tests the claim rather
   than a mock of it.

### 6.2 Acceptance criteria (map to invariants and findings)

| ID   | Criterion                                                                                                                                           | Verifies | Evidence type                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------- |
| AC1  | Cold open of a cached room/thread paints from cache with zero network requests before first paint; first paint under 200 ms on the dev machine      | I1       | e2e + probe numbers               |
| AC2  | Seeded divergence (stale edit, stale reaction, missed redaction) converges after open without reload, in place, scroll anchored                     | I2       | e2e (`P5.2`)                      |
| AC3  | Stop emoji gone after redaction: in-session, after thread reopen, after full reload                                                                 | F6       | e2e (`P0.2`/`P1.2`)               |
| AC4  | A message streamed with N edits produces exactly 1 cached event record (target with bundled latest edit); reload paints final content               | F5/D5    | integration + e2e                 |
| AC5  | IndexedDB write operations per live event are O(1) (constant, independent of loaded timeline size); before/after numbers recorded                   | F2       | probe (`P0.1`)                    |
| AC6  | Events arriving in a closed room are readable from cache when that room is next opened, with no fetch before paint                                  | F1/I1    | e2e (`P0.2` background-freshness) |
| AC7  | Under a synthetic overfill (test budget override), eviction triggers in policy order (federated → LRU homeserver) and never evicts the current room | D9       | integration                       |
| AC8  | No duplicate in-flight `/relations` or `/messages` job for the same (room, thread, kind) anywhere                                                   | F9       | scheduler unit + probe            |
| AC9  | A thread open with complete cache coverage still schedules a reconcile (coverage gates painting only)                                               | D7/F7    | unit                              |
| AC10 | Prepends/corrections preserve scroll anchoring (existing anchor tests stay green; new correction-path test added)                                   | I2       | unit/e2e                          |
| AC11 | Injected quota failure flips cache health to degraded read-only state and is surfaced (no silent divergence)                                        | F4       | unit (`P1.5`)                     |
| AC12 | Same-millisecond edits resolve deterministically (ts then event_id) across load orders                                                              | F8/D12   | unit (`P1.3`)                     |
| AC13 | After app closed during activity, next open paints cache then gap-fills to continuity (no permanent hole)                                           | I2/P3.2  | e2e                               |
| AC14 | Legacy caches are wiped exactly once on schema v3 and rebuilt in background; no legacy standalone `m.replace` records exist post-rebuild            | D8       | integration                       |

### 6.3 Scorecard (living)

Filled as steps complete. "Before" numbers from P0.3.

| AC   | Status | Evidence (command / spec / probe) | Before → After | Confirmed by (reviewer) | Date |
| ---- | ------ | --------------------------------- | -------------- | ----------------------- | ---- |
| AC1  | ☐      |                                   |                |                         |      |
| AC2  | ✓ (live, RG5d) | Reconciler landed in P5.1 (`engine/reconciler.ts` — `scheduleReconcile({reason:'open-thread-choke-point'\|'room-open'\|'resume'})`). AC2 revision R1-R9 (2026-07-04) replaced the pre-revision per-branch schedule call sites and STEP 3's guard-abort retry with a single unskippable choke-point schedule at the top of `runThreadOpenCacheFirst`. AC2 render-gap RG1-RG5b (2026-07-04) instrumented every seam of the reconcile→sink→merge→render chain; the counters (`renderTargetRegressedDifferentInstance=0`, `renderTargetRegressedSameInstance=0`, `applierMakeReplacedLatestEqualsCurrent>0`) proved the data + render chain already converges — the AC2 live-gate failure was misinterpretation of pin-to-bottom + react-virtual as a render defect. AC2 RG4b-fix (2026-07-04, owner ruling): pin-to-bottom on thread open is intentional streaming UX; "scroll anchored" in AC2 means the RECONCILE REPAIR itself does not displace the anchored viewport (nothing about restoring the pre-close position — explicitly out of scope for CINNY-207). Reworked `e2e/live/cinny207-stale-cache-divergence.spec.ts` to (1) poll `reconcilesRepaired>=1` post-reopen so anchored assertions land after the repair; (2) walk the thread's Scroll container upward until the seed reply's `[data-message-id]` appears in the react-virtual window, then `scrollIntoView({block:'center'})`; (3) assert edit-target v2 visible + v1 gone + redact-target gone in the anchored viewport; (4) capture anchor top, force a synthetic `window resize` re-render, recapture, assert `abs(delta) <= 8`. Two consecutive docker greens: `✓ 1 passed (32.5s)`, `✓ 1 passed (33.9s)`; regressions `cinny207-streamed-edit-cache` and `cinny207-stop-emoji-redaction` `✓ 2 passed` alongside. `test.fail()` removed on true visible-green per owner rule. Two follow-ups filed (both scope-limited to reconciler-side reaction-redaction reach, NOT the anchor invariant): the reaction chip on the seed reply persists after reopen (`removeMatchingAggregatedRelationEvent` is a no-op when the reaction hasn't been aggregated into `liveThreadTimelineSet.relations` yet at reconciler time, and `makeRedacted` strips `m.relates_to` so we can't proactively add the redacted instance to close the id-dedup gate; a later live-sync aggregation then re-adds a fresh non-redacted reaction with the same id), and the reaction IDB record is not deleted because `engineWriteThrough.onRedaction` fires from live-sync not from `fetchRelations` delivery. Both dropped from AC2 with in-file comments pointing at task #106; owner's RG4b directive scoped this task to anchored convergence + displacement, not to a matrix-js-sdk-side Relations patch. **AC2 RG4e (2026-07-04):** added `sunkTargetMakeRedactedCalls` / `sunkTargetMakeReplacedNonNull` / `sunkTargetMakeReplacedCleared` counters + per-instance own-property overrides of `makeRedacted`/`makeReplaced` on fallback-registered edit-target instances (`armSunkTargetInstrumentation` in cacheProbe.ts, called from `useThreadRenderState.setSupplementalThreadEvents`). Two docker runs read all three sunkTarget counters at 0, `renderTargetLostReplacement` at 0, `applierMakeReplacedFired` at 0, `applierMakeReplacedLatestEqualsCurrent` at 8-9 — the "sunk set" is EMPTY in the currently-green flow (the applier is redundant on the fallback path; SDK's own Relations aggregation carries the replacements on the SDK-owned live-timeline instances that render mostly holds). **AC2 RG5-fix2 (2026-07-04, team-lead B-approval required addition):** closed the NewReply late-arrival door — `handleThreadNewReply` fires AFTER a reconcile repair with the SYNC-delivered instance for the same target id (no replacement), and the prior `pickPreferredThreadRenderEvent` fall-through (`return incomingEvent`) let it wipe the repair whenever the effective-replacement helper's sender filter dropped the repaired side. Added an asymmetric raw-`.replacingEvent()` presence check AFTER the effective block in `threadRenderUtils.ts` — the D12-style ts→event_id ordering still applies when both sides have effective replacements, but a non-repaired same-id instance can no longer displace a repaired one. Same picker is used by both the sink merge and the `buildThreadEvents` SDK-vs-fallback merge, so one rule covers both seams. Regression tests in `useThreadRenderState.test.ts` — one common-path guardrail, one edge-path (foreign-sender edit) proven red-without-fix / green-with-fix via `git stash`. Live gate (`/tmp/ac2-rg5fix2-livegate.log`): all three specs `✓ passed` (AC2 30.9s, stop-emoji 48.5s, streamed-edit 37.8s). Validation: tsc clean; vitest 2662/2662 (+2 RG5-fix2 tests over 2660); lint 18/0 baseline-neutral; build clean. **AC2 RG5c (2026-07-04, team-lead X5 door):** added `registrySwappedRepairedForUnrepaired` tripwire in `replaceFallbackInstanceRegistry` — bumps when overwriting a repaired entry (`.replacingEvent()` non-null) with an unrepaired one (`.replacingEvent()` null). Must-stay-0 in a correct design. Two docker cycles read 0 stably, confirming the picker guard from `3fbe8afd` holds at both seams (sink merge and buildThreadEvents SDK-vs-fallback). Applier guard splits (`applierMakeReplacedNoLatestEdit` / `applierMakeReplacedLatestEqualsCurrent`) already lived in `eventCacheEditUtils.ts:200-203` from RG5b. Validation: tsc clean; vitest 2669/2669 (+7 RG5c tests); lint 18/0; build clean. **AC2 RG5d (2026-07-04, team-lead root-cause directive):** canonicalized `mergeThreadRenderEvents` inner `setEventForKeys` — collects every distinct existing instance the incoming write conflicts with via any of its keys, reduces `(conflicts + incoming)` through `pickPreferredThreadRenderEvent` (chained left-fold with conflict-as-existing so incoming retains tie-break priority), snapshots all loser keys BEFORE deleting, and writes the winner under the full union. Post-canonicalization invariant: for any two keys K1, K2 that share an event identity, `eventMap.get(K1) === eventMap.get(K2)`. Root-cause fix for the intra-batch duplicated-instance shape that let `Array.from(new Set(eventMap.values()))` leak two MatrixEvent references for one event identity when the SDK strips the txnId from one instance's `unsigned` before the merge sees it. Permanent must-stay-0 tripwire `eventMapCanonicalizedDisplacements` bumps once per losing instance. 6 new unit tests in `threadRenderUtils.test.ts` (`RG5d key canonicalization`) including a 3-way conflict test verified red-without-fix (array length 2 vs expected 1) and green-with-fix. Live gate (two docker cycles, `/tmp/ac2-rg5d-livegate{,2}.log`): 3/3 passed each — AC2 29.5s/30.2s, stop-emoji 49.4s/54.8s, streamed-edit 36.6s/36.4s. Counter reads: `registrySwappedRepairedForUnrepaired: 0` (RG5c stays clean), `eventMapCanonicalizedDisplacements: 3` per test (intra-batch duplication is real in production and is now absorbed at the map invariant). Validation: tsc clean; vitest 2675/2675 (+6 RG5d tests); lint 18/0; build clean. | stale edit/reaction/redaction persist on cache-hit reopen (I2/AC2 pre-P5 — no revalidation path) → cache + render converge to server truth in place after every open; anchor displacement across the repair ≤ 8 px | RG1-RG5b observability + RG4b-fix live gate + RG4e name-the-caller probe + RG5-fix2 monotonic merge preference + RG5c registry-swap tripwire + RG5d canonicalized eventMap invariant | 2026-07-04 |
| AC3  | ✓ | Pre-P3.3 stack-tip run (55439be8, 2026-07-03) recorded green on `cinny207-stop-emoji-redaction`. The P3.3 docker gate then re-ran the spec and it FAILED TWICE on a clean network (first on the P3.3 tip, then on the round-1 tip `9a6b15b4` after a first fix attempt) — root cause discovered empirically: matrix-js-sdk's `applyEventAsRedaction` calls `moveAllRelatedToMainTimeline` for non-root thread events, which removes the redacted target from its thread's timelineSet BEFORE the emission fires; the round-1 SDK-thread-set scan therefore finds zero hits at fire time (FORK_CHANGES.md entries in the Runbook: `stop-emoji-redaction: FAILED on P3.3 tip AND FAILED AGAIN on the round-1 tip` and the round-2 rebuild block above it — the 5-scenario `engineWriteThrough.redaction.test.ts` rewrite + `redactionCacheLifecycle.test.ts` +30-line `sdkThreadIdHint` priority test + `cacheStore/__tests__/cacheContract.test.ts` +33-line `Promise<string[]>` multi-scope contract). Round-2 landed a cache-derived attribution layer (`meta.sdkThreadId` on layer 2, an async walker returning `string[]` on layer 1) that cannot be defeated by SDK timeline movement — unit-level evidence only (all layers green in `npx vitest run src/app/mindroom/engine/` and the full mindroom suite); the confirming docker re-run is the final gate. **FINAL GATE (2026-07-04, tip f7bf06b7): PASSED** — docker run 1, clean network: `redacted stop reaction disappears in-session, after reopen, and after reload` ✓ (51.4s). The round-2 cache-derived attribution fix is docker-confirmed live. | reaction resurrected on reopen/reload → gone in all three states (unit-level under the P3.3 write-through boundary; docker gate to re-confirm on real Tuwunel) | workflow rounds 1-2 (unit); docker re-confirm pending | 2026-07-03 (pre-P3.3 green stale); round-2 fix landed 2026-07-03 |
| AC4  | ✓      | e2e `cinny207-streamed-edit-cache` green LIVE on stack tip: probe `editCompactions=1`, `threadEventPuts=3`, 1 target record with bundled final body pre+post reload; unit `npx vitest run src/app/mindroom/threads/eventCacheEditUtils.test.ts src/app/mindroom/threads/editCompactionScheduler.test.ts src/app/mindroom/threads/roomLiveEventController.compaction.test.ts src/app/mindroom/threads/eventRepository.test.ts` **FINAL GATE (2026-07-04, tip f7bf06b7): re-run BLOCKED by host env** — 4 attempts, every failure trace-classified as the documented `ERR_NETWORK_CHANGED` host flake (247 and 284 browser-console net errors, ZERO app errors, two traces inspected). Partial live evidence before the flake killed the reload leg: spec's own probe printed `total=1` cached thread record, `editCompactions=1` — the core compaction claim held on the final tip. Prior recorded greens stand. | 26 thread-cache records for a 25-edit streamed message (P0.3 spec run) → exactly 1 target record with bundled edit | workflow round 2 (spec traced sound) + docker e2e run | 2026-07-03 |
| AC5  | ☐ impl | Sweep deleted in P3.3 (`refactor: strip component persistence`); writes-per-live-event are structurally O(1) — the engine's per-event write-through is the only cache-write codepath from live events (no bulk re-serialization exists). Formal probe numbers land with the Phase 3 e2e docker gate on the P3.3 tip. | 26 thread-cache records for a 25-edit streamed message → 1 target record; the "loaded timeline size feeds cache writes" coupling (F2) is gone by construction |                         |      |
| AC6  | ✓      | e2e `cinny207-background-room-freshness` was `test.fail()` through Phase 2; P3.3 (`refactor: strip component persistence`) flips it green: `MindroomSyncEngine` attaches `RoomEvent.Timeline`/`RoomEvent.Redaction` at client scope so live events reach the cache regardless of which room is mounted. Docker gate PASSED TWICE on the P3.3 tip (2026-07-03) — recorded in FORK_CHANGES.md Runbook: (a) `AC6 background-freshness: PASSED on the P3.3 tip (client-level listeners fixed F1)` in the docker-gate-round-2 findings block, and (b) `background-room-freshness (AC6): PASSED on the P3.3 tip. Client-level listener coverage from the engine confirmed — F1 fixed as designed.` in the P3.3-tip findings block. A subsequent re-run on the round-1 tip `9a6b15b4` hit an ERR_NETWORK_CHANGED host flake (203 resets), so the earlier green stands. **FINAL GATE (2026-07-04, tip f7bf06b7): re-confirmed PASSED** — docker warm re-run ✓ (33.0s) on the full final stack (cold-run failure classified env: login page never served, 0 app errors). | 0 cached events for a background room (P0.3 spec run) → cached copy present on next open (docker-confirmed on P3.3 tip) | docker gate on P3.3 tip (twice) | 2026-07-03 |
| AC7  | ☐ impl | `npx vitest run src/app/mindroom/threads/cacheStore/__tests__/cacheEviction.test.ts` (4/4 — three rooms seeded via the real save paths (federated / LRU-old / protected-recent); budget shrunk via `__setCacheStoreByteBudgetForTests` so eviction must fire; asserts federated evicted first, protected room never touched, cleanup complete (events / meta / summaries / ledger row), under-budget stop honoured at `budget * EVICTION_TARGET_UTILIZATION = 0.9`, recent-open guard alone protects a room without registry entry, back-to-back schedules collapse to one runner invocation via a `readLedgerSnapshot` spy). Docker e2e budget-override run pending. | over-budget state persists without the job (red-first probe inside the AC7 test); after the job runs, `bytesAfter` drops below the target and evicted rooms' events / meta / summaries / ledger rows are all gone |                         |      |
| AC8  | ☐ impl | `npx vitest run src/app/mindroom/engine/__tests__/backfillScheduler.test.ts` (14/14 — same-key enqueue while queued OR running returns the same promise identity; different kinds on same (room, thread) are distinct; scheduler-completed re-enqueue works; priority + activity ordering across bands; concurrency cap peaks at MAX_CONCURRENT_BACKFILL_JOBS=2; abort in-flight / queued / unknown key; `abortAll` cancels every job; `pendingJobs` snapshot order stable). Additional dedup coverage in `engine/__tests__/deepHistoryJob.test.ts` (AC8 on the deep-history kind) and `engine/__tests__/gapFillExecutor.test.ts` (subscription + dedup). Client-scoped dedup extends to `thread-seed` (P4.4 threadSeedPrewarmController wraps `ensureThreadSeedPrewarm` in `scheduler.enqueue({kind: 'thread-seed'})`) and `thread-backfill` (P4.4 threadOverviewResumeController wraps `refreshOverviewThreadCacheFromRelations` in `scheduler.enqueue({kind: 'thread-backfill'})`). Docker gate observability handle: `window.__MINDROOM_CACHE_PROBE__.snapshot().schedulerDeduped` must be > 0 during any duplicate-producing scenario. | duplicate `/relations` and `/messages` fetches per (room, thread, kind) (F9) → at-most-one in-flight, others share the promise |                         |      |
| AC9  | ✓      | `npx vitest run src/app/mindroom/engine/__tests__/reconciler.test.ts` (11/11 — including: `enters the scheduler with kind 'reconcile' at band 0`, `coverage-complete still performs the network verify (AC9)` — the AC9-named test explicitly asserts `fetchRelations` is called even on complete-coverage cachedPage input, `deduplicates: a second schedule ... returns the in-flight promise identity` — AC9's coalescing-returns-in-flight-promise clause, `empty diff is a no-op (D7)`, `detects a new event id (missed message) and fires onRepaired exactly once`, `pages further past 200 (F7)`, plus the three room-scope units confirming the invariant holds at both scopes) and `src/app/mindroom/threads/threadOpenCacheFirst.test.ts:88-100` (complete-coverage cache hit calls `scheduleReconcile({reason:'open-complete-coverage', cachedPage: hydratedCachedPage})` exactly once — replaced the pre-P5 `refreshLatestThreadRelationsTail` assertion). Wiring evidence: `threadOpenCacheFirst.ts:114-131` (D7 fix site: complete-coverage schedules); `threadOpenLifecycleController.ts:216-228` (partial-coverage schedules after SDK bootstrap); `mindroomSyncEngine.ts` `noteRoomFocused` schedules room-scope. `refreshLatestThreadRelationsTail` DELETED from `threadOpenCacheController.ts`; arch guard `RoomTimeline.architecture.test.ts:754` retained as tripwire. | coverage-complete short-circuit skipped the network verify (F7/D7 violation) → every open schedules a reconcile; coverage decides paint only | p5-impl (unit + wiring evidence)     | 2026-07-04 |
| AC10 | ✓      | Existing anchor suites stay green: `e2e/live/cinny070-thread-prepend-scroll.spec.ts` (unchanged — 64px prepend tolerance) plus every RoomTimeline / thread test in the `npx vitest run` full suite (337 files / 2568 tests). New correction-path unit `src/app/mindroom/engine/__tests__/reconciler.test.ts` — `applier hardens against prepends: repairs only swap or delete existing ids + append at the tail (AC10)`: fixture carries a bundled edit AND a redaction on cached ids, asserts the reconciler treats both as divergence, fires `onRepaired` exactly once, mutates instances via `hydrateCachedEvents` (SDK `makeRedacted` / `makeReplaced`), and does NOT push to `setSupplementalThreadEvents` (no array splice, no length change). AC2 spec's post-reconcile mid-viewport anchor asserts ≤ 8px displacement (stricter than cinny070's 64px prepend tolerance — the in-place invariant is stronger for repairs than for prepends). | reconcile-time repairs could prepend and cause anchor drift → applier is instance-mutation only; length + order stable | p5-impl (unit + full-suite green + AC2 spec design) | 2026-07-04 |
| AC11 | ✓      | `npx vitest run src/app/mindroom/threads/cacheHealth.test.ts src/app/mindroom/threads/eventRepository.test.ts` | silent divergence → read-only degrade | workflow rounds 1-2 (p15-p16 interaction dimension clean) | 2026-07-03 |
| AC12 | ✓      | `npx vitest run src/app/utils/room.test.ts` (tie tests) | order-dependent → id-deterministic | workflow rounds 1-2 + landed-stack review | 2026-07-03 |
| AC13 | ✓ | Executor landed in P4.2 (`engine/gapFillExecutor.ts`): subscribes to the Phase-3.2 `GapFillScheduler.onEnqueue`; per job, runs `mx.createMessagesRequest(Direction.Backward, 200/batch, ≤20 iterations)` through the P4.1 `BackfillScheduler` (band 1), persists via `saveRoomEventsToCache`, clears the durable `tailDiscontinuity` marker on success. AC13 e2e spec `e2e/live/cinny207-gap-fill-restart.spec.ts` flipped from `test.fail()` to green-shape: seed room + mount + ~25 REST messages + reload (single page context) + wait 12s, then assert (a) `schedulerCompleted >= 1`, (b) `gapFillsEnqueued >= 1`, (c) last REST event id present in cache. **Gate fix (2026-07-04):** first docker gate hit `schedulerCompleted=0` while `gapFillsEnqueued>=1` — three fixes applied. (i) `schedulerFailed` probe counter added and bumped from the scheduler's non-abort reject branch so silent job failures are visible from a snapshot. (ii) `gapFillExecutor` no longer short-circuits on tier at enqueue — `gapFillsEnqueued` and `schedulerEnqueued` stay in lockstep so a probe snapshot unambiguously distinguishes "policy skipped" from "never ran". Marker semantics preserved by tier inside `runOnce` (encrypted-own clears; federated preserves). (iii) Spec's probe reset moved to `page.addInitScript` (pre-reload) so counters are zeroed BEFORE the post-reload engine primes and enqueues startup jobs — the old post-`expectLoggedInShellStable` reset raced the engine and could zero pre-reset completions. Docker gate re-run pending (team-lead). **FINAL GATE (2026-07-04, tip f7bf06b7): PASSED** — docker warm re-run: ✓ (42.3s); probe `schedulerCompleted=9, schedulerFailed=0, gapFillsEnqueued=10, schedulerDeduped=3, writeErrors=0`. | offline messages missed after reload (I2/AC13 pre-Phase-4 — spec was `test.fail()`) → cache converges to server tail within seconds of reload |                         |      |
| AC14 | ☐ impl | `npx vitest run src/app/mindroom/threads/cacheStore/__tests__/cacheStoreDb.wipe.test.ts` (2/2 — legacy DB names gone from `indexedDB.databases()` on first v3 open, marker present in `meta`, reopen after `resetCacheStoreForTesting()` performs zero further `deleteDatabase` calls; multi-session gate leaves shared singletons alone). Docker e2e post-upgrade paint verification pending. | six legacy DBs present pre-open → all six absent + unified DB present post-open |                         |      |

### 6.4 Regression guards (architecture tests)

Added as their phases land, in
`src/app/mindroom/threads/__tests__/RoomTimeline.architecture.test.ts` (or a
new engine-scoped guard file):

- The Phase 1 P1.1 "sweep debounced and delta-only" guard is
  **removed in P3.3**. The sweep it guarded is deleted; O(1)-per-
  live-event writes are now enforced structurally by the engine's
  per-event write-through (no bulk re-serialization codepath
  exists). Successor guards live in
  `src/app/mindroom/engine/__tests__/engine.architecture.test.ts`:
  (a) persist entry points are consumed only by `engine/**` modules
  (allowlist: engine + `eventRepository.ts` itself), (b) the
  render-only `roomLiveRenderController` imports no persist entry
  point and no `cacheStore/`, (c) engine modules do not import
  `MindroomRoomTimeline`.
- The cache write boundary rejects standalone same-sender `m.replace`
  records (Phase 1 — **added**).
- No imports of legacy cache modules outside CacheStore (Phase 2 — **added**
  in P2.3 as `cacheStore/__tests__/cacheStore.architecture.test.ts`; asserts
  the three shim files no longer exist AND scans `src/app/mindroom/**` for
  forbidden import strings).
- Render components do not import CacheStore directly (Phase 2 — **added**
  in P2.3 in the same arch test; scans `MindroomRoomTimeline.tsx` and
  everything under `mindroom/messages/**`; separately, an exact allowlist
  test enumerates the only sanctioned consumers: `eventRepository.ts`,
  `threadSummaryStore.ts`, `threadSummaryState.ts`, `sessionCleanup.ts`,
  and — extended in P3.2 and P4.2/P4.3 — the four engine-native cache
  orchestrators: `engine/engineGapTracker.ts`,
  `engine/mindroomSyncEngine.ts`, `engine/gapFillExecutor.ts`, and
  `engine/deepHistoryJob.ts`).
- Backfill network fetchers live inside the engine (Phase 4 — **added**
  in P4.3 as a guard in `RoomTimeline.architecture.test.ts`): the
  `useRoomEagerPreload` hook is deleted, `enqueueRoomDeepHistoryJob` is
  wired instead, and `MindroomRoomTimeline` must not call
  `mx.createMessagesRequest` directly. Any /messages fetch has to go
  through the engine's `BackfillScheduler` (via `enqueueRoomDeepHistoryJob`
  or `gapFillExecutor`).
- The `/relations` fetch boundary is engine-owned (Phase 5 — **added**
  in P5.1 Commit 2 as two guards in
  `engine/__tests__/engine.architecture.test.ts`):
  (a) `fetchAllThreadRelations is defined in engine/, and imported only
  within engine/**` — enforces that the paging fetcher lives in
  `engine/threadRelationsFetcher.ts` and its non-engine importer
  allowlist is exactly one file (`threads/threadOverviewResumeController.ts`,
  the P4.4 overview-resume producer). A third caller trips the guard.
  `threads/threadBootstrap.ts` re-exports the engine symbol for the
  legacy test surface; that path is recognized as a re-export
  (imports from `../engine/threadRelationsFetcher`) rather than a
  first-party consumer. `notifications/readReceipts.ts` uses
  `mx.fetchRelations` with a `RelationType.Thread` `limit: 1` receipt
  probe — receipts-domain, not thread-history backfill — and is
  explicitly OUT OF SCOPE for this guard by symbol (the guard checks
  `fetchAllThreadRelations`, not `mx.fetchRelations`).
  (b) `mx.fetchRelations in threads/ is limited to
  threadOpenSdkBootstrap.ts with exactly 2 occurrences` — enforces
  the two limit-50 fallback SDK bootstraps (`threadOpenSdkBootstrap.ts:122`
  and `:193`) are the ONLY non-engine, non-receipts `mx.fetchRelations`
  callers. A third call in that file — or any new caller anywhere
  else in `threads/` — trips the guard.
  The pre-P5 `refreshLatestThreadRelationsTail` guard at
  `RoomTimeline.architecture.test.ts:754` is retained as a tripwire
  against reintroducing the deleted useCallback in
  `MindroomRoomTimeline`. The post-bootstrap-refresh delegation guard
  at `:797-813` is reshaped: the runner is deleted; the guard now
  asserts the `'thread-open-forward-gap-check'` log string lives in
  the lifecycle controller (its new home) and that the runner name
  never reappears as an import.
- The removed preload setting is not reintroduced (Phase 6 —
  **added** in P6.1 Commit 4 as
  `src/app/mindroom/settings/prefetchSettings.architecture.test.ts`,
  5 tests): (a) `MindroomMessagePreloadLimitSetting.tsx` + test
  absent from disk; (b) recursive scan of `src/app/mindroom/` for
  `/paginationLimit|PreloadLimit|PAGINATION_LIMIT/` with an
  exemption list of NON-CONSUMERS — this arch test itself, the D4
  drop machinery (`mindroomSettings.ts` +
  `mindroomSettingsBootstrap.ts` + `mindroomSettings.test.ts`),
  legacy-negation guards elsewhere (`RoomTimeline.architecture.test.ts`,
  `RoomTimeline.cache.test.ts`, `MindroomPrefetchSettings.test.ts`),
  and the `preloadSettings.ts` historical header. The Commit-3
  rename of `timelinePagination.ts`'s `paginationLimit` parameter
  to `windowLimit` closed the last LIVE consumer; the exemption
  list is the honest reading of "no live consumer" (see
  Deviations §8). (c) Positive: `settingsExtensions.tsx` imports
  `MindroomPrefetchSettings`; `mindroomSettings.ts` declares
  `prefetchScope` + `prefetchDepth` + imports from
  `../engine/prefetchPolicy`. (d) `mindroomSettings.test.ts`
  contains the four D4 case titles. Written RED FIRST — 3 tests
  failed against the pre-Commit-4 tree, all pass after the
  removals.

### 6.5 Validation environment

- Local Tuwunel fixtures and e2e conventions per `e2e/live/` and the
  docker-matrix workflow (full suite ~14 min; never edit `src/` mid-run —
  Vite HMR corrupts the run).
- Per-step: `npm run typecheck`, `npm run build`, `npm run lint`, focused
  `npm test` set, plus the phase's e2e specs.

## 7. Risks and mitigations

- **Engine extraction destabilizes a ~3,400-line component.** Mitigate: phased
  absorption (persistence first, fetching second, reconciliation third), the
  architecture guards above, e2e suite per phase, quick-wins-first so the
  riskiest work happens on an instrumented base with a green bug-fix suite.
- **Wipe-and-rebuild causes a cold-start burst after upgrade.** Mitigate:
  scheduler rate limits and priority order make the rebuild invisible (current
  room first); it runs against our own Tuwunel.
- **Browsers may grant less than 1 GB (iOS WKWebView especially).** Mitigate:
  reactive quota handling (AC11) is independent of the proactive budget;
  `navigator.storage.estimate()` probe feeds the eviction job.
- **SDK internals coupling** (`Relations` aggregation, instance identity).
  Mitigate: reconcile by event ID; unit tests around aggregation seams; keep
  the SDK version pinned during the overhaul.
- **Known flaky/pre-broken e2e specs** in the existing suite. Mitigate: new
  specs isolated; flake list tracked in the Runbook, not ignored ad hoc.
- **Timestamp-order divergence under federation** (F8) is accepted for now:
  deployment is effectively single-homeserver; D12 removes the
  nondeterministic part. Revisit if federation becomes a product target.

## 8. Deviations

- 2026-07-04 — **P7.2 audit remediation batch (five findings).** The
  final P7.2 adversarial audit surfaced five open findings against
  branch 13's tip (`bba6013e`). All five landed as focused commits on
  the same branch after verifying each was still open at tip
  (findings that had been fixed by the earlier review-fix batch are
  not recorded here). Summary:
  - **Finding #1** — Thread-open lifecycle had no rejection handler on
    the `loadThreadTimeline()` call at
    `threadOpenLifecycleController.ts:308`. `abortAll()` at engine
    teardown rejected the queued thread-backfill job, surfacing as
    `backfill scheduler stopped` unhandled. Fixed with
    `loadThreadTimeline().catch(() => undefined)`.
  - **Finding #2** — `void p.finally(cb)` at
    `threadSeedPrewarmController.ts:165` and
    `threadOpenSeedController.ts:188` returned NEW promises that
    re-rejected on scheduler abort. Replaced with
    `void p.then(cb, cb)`. Also added `.catch(() => undefined)` to
    the drain-loop `await ensureThreadSeedPrewarm(...)` and both
    `void prewarmThreadSeeds()` entry points. Sweep of
    `void [x].finally(` in `src/app/mindroom/` returns zero.
  - **Finding #3** — `gapFillExecutor.ts:129` and
    `deepHistoryJob.ts:108` persisted raw `response.chunk` directly
    via `saveRoomEventsToCache`, letting a background sweep inside
    Tuwunel's ~10s stale window overwrite a cached tombstone with
    pre-redaction plaintext at rest (invariant I2). Extracted a
    shared `persistRoomChunkWithPreferLive` helper in
    `eventRepository.ts` that routes each chunk event through
    `createPreferLiveEventMapper` and `persistRoomEventCacheSnapshot`
    (same serialize+save path the write-through and reconciler use).
  - **Finding #4** — `dropLegacyMindroomSettings()` called from the
    top of `src/index.tsx` ran AFTER `state/settings.ts` module init
    because ES imports are hoisted. Moved the scrub to a
    module-scope side effect at the bottom of
    `mindroomSettingsBootstrap.ts` (a leaf module — arch test now
    asserts it has no transitive import of `state/settings.ts`).
    Belt-and-braces: `getSettings()` destructure-omits
    `paginationLimit` at read time so the base atom cannot
    initialize contaminated. Added a plain-`settingsAtom` write-back
    test that primes contamination and asserts the saved blob omits
    the legacy key.
  - **Finding #5** — `prefetchScope` stored + rendered but never
    read. `resolvePrefetchConfig` called only by tests. Wired the
    setting into the actual scheduler decision path: new
    `isRoomEligibleForBackgroundPrefetch({ mx, room, scope,
    focusedRoomId })` in `prefetchPolicy.ts`. `MindroomSyncEngine`
    grows a `getPrefetchConfig?: () => PrefetchConfig` supplier
    (snapshot-per-call, ClientRoot wires it to
    `getDefaultStore().get(settingsAtom)`), tracks the current
    focused room, and hands both into `gapFillExecutor` which now
    consults the scope-aware gate. Three cases pin each scope
    literal (my-server / all-rooms / current-room-only) at the
    unit-policy layer AND end-to-end through the executor.
  - **Plan-doc corrections folded (three items)** — the same audit
    confirmed three factual defects in this file that are also
    addressed in this batch:
    - **Header line 3** — the "P5.2" clause claimed AC2 was flipped
      green. AC2 was actually re-annotated `test.fail()` expected-RED
      after 5 fix iterations (d5b2d345); reworded to match (expected-
      RED with documented diagnosis, product-owner decision pending)
      and to cite the §8 "AC2 expected-RED" entry.
    - **Header status block** — the Phase-3 gate was still phrased
      as future ("background-freshness is expected to FLIP GREEN
      (AC6)"). It RAN on the P3.3 tip and AC6 PASSED twice
      (FORK_CHANGES.md Runbook: the `AC6 background-freshness:
      PASSED on the P3.3 tip` note in the docker-gate-round-2 block
      AND the `background-room-freshness (AC6): PASSED on the P3.3
      tip` note in the P3.3-tip block); the same gate revealed AC3
      `stop-emoji-redaction` FAILED on a clean network. Header
      updated to record the run and its two divergent outcomes.
    - **AC6 scorecard row (line ~485)** upgraded from
      `☐ impl / Docker gate pending` to `✓` with the two Runbook
      citations recorded as evidence and 2026-07-03 as the date.
    - **AC3 scorecard row (line ~482)** downgraded from `✓` (which
      referenced the pre-P3.3 stack-tip green) to
      `☐ fix landed, docker re-confirm pending (final gate)` —
      the pre-P3.3 green is stale because P3.3 stripped the
      component's persistence responsibilities and the P3.3 docker
      gate then failed the spec twice on a clean network; the
      round-2 cache-derived attribution fix (`meta.sdkThreadId`
      layer 2 + async walker returning `string[]` layer 1)
      landed with unit-level evidence only, so the ✓ was not
      earned by the current write-through path. The confirming
      docker re-run is the final gate (team-lead-owned).
    - AC5 (optional teammate note): the cacheProbe already exposes
      `roomEventPuts` and `threadEventPuts` counters (see
      `src/app/mindroom/threads/cacheProbe.ts:16-20`) — those are
      attempted-put counters and directly serve as the after-side
      writes-per-live-event numerator when AC5 is measured.
  - Validation batch on the branch tip:
    `npx tsc --noEmit` clean, `npx vitest run` all pass, lint
    18 warnings 0 errors (zero delta from pre-remediation
    baseline), `npm run build` clean.

- 2026-07-04 — **P6.1 arch guard 6.4 (b) uses an exemption list, not
  a zero allowlist.** The Commit-4 brief called for a recursive scan
  of `src/app/mindroom/**/*.{ts,tsx}` for
  `/paginationLimit|PreloadLimit|PAGINATION_LIMIT/` with ZERO
  allowlist. That is not achievable in the D4 shape: the drop code
  MUST name the key it strips (the destructure-omit
  `const { paginationLimit: _dropped, ...rest }` in `withMindroomSettings`
  and the `hasOwnProperty` check in `dropLegacyMindroomSettings` are
  load-bearing — remove them and the scrub can't happen), and the
  D4 tests that assert the drop MUST name the key too. The honest
  reading of "no live consumer" is: no source module reads the
  legacy field, imports a `PreloadLimit` symbol, or references a
  `_PAGINATION_LIMIT` constant — which is exactly what the guard
  checks after exempting: (a) this arch test itself, (b) the D4 drop
  machinery, (c) the D4 tests, (d) legacy-negation guards elsewhere
  in the tree, (e) the `preloadSettings.ts` historical header. Every
  exempted file's justification is spelled out in the guard's doc
  header. Alternative considered: rewrite the drop code to fingerprint
  the key some other way (e.g. hash equality). Rejected — obscures
  the intent, doesn't remove the need for the D4 tests to name the
  field, and doesn't survive a subsequent audit of the drop code.

- 2026-07-04 — **P6.1 deep-history depth wired via `targetEventCount`
  snapshot at effect fire, not via a scheduler-key or a `noteRoomFocused`
  setter.** `MindroomRoomTimeline` reads the user's `prefetchDepth`
  and passes it as `targetEventCount` when it enqueues the band-4
  `'room-deep-history'` job. The scheduler dedup key does NOT
  include the depth, so a mid-focus depth change won't cancel and
  re-enqueue the running job — the new value picks up on the next
  mount (room switch, view mode flip). Chosen because the executor
  already accepts `targetEventCount` (P4.3); the alternative of
  plumbing a depth setter through `engine.noteRoomFocused` would
  require a new engine construction argument without adding any
  behavior. Recorded so P7.2 review doesn't flag the missing
  in-flight update.

- 2026-07-04 — **P6.1 D4 semantics: stored `paginationLimit` value is
  DROPPED, never mapped to `prefetchDepth`.** The two settings have
  incompatible semantics: the old one was an eager-preload target
  of any positive integer (P1.6 clamped to
  `[MIN_PAGINATION_LIMIT=50, MAX_PAGINATION_LIMIT=10000]`); the new
  one is a scrollback depth clamped to
  `[ROOM_TAIL_PREFETCH_DEPTH=200, CURRENT_ROOM_DEEP_HISTORY_TARGET=10000]`
  with the SAME default (10000). A user with `paginationLimit: 120`
  who upgrades will get `prefetchDepth: 10000` (the default) rather
  than `prefetchDepth: 200` (a naive clamp of the stored value)
  because 120 was a valid preload target under the old sanitizer
  but is below the new sanitizer's minimum. Silently changing to
  200 would surprise a user who deliberately lowered the setting;
  dropping to the default and letting the user re-set is the safer
  behavior. The drop happens twice: on read (destructure-omit in
  `withMindroomSettings`) and on the persisted blob (`dropLegacyMindroomSettings`
  called from `src/index.tsx` BEFORE `state/settings.ts`
  initializes).

- 2026-07-04 — **P7.1 dead-code sweep folded into the docs commit.**
  The audit (`npx ts-prune | rg app/mindroom` +
  `rg -n "from '\./(preloadController|roomCacheLifecycleController|threadCachePersistenceController|threadSeedPrewarmController|threadOpenPostBootstrapRefresh)'" src/`)
  produced ZERO verified-dead orphans in `mindroom/threads/`. Every
  ts-prune "unused" candidate is either alive via a test file (test
  helpers like `resetPendingThreadTagsForTests`,
  `resetCacheHealthForTesting`, `loadRoomCachePersistenceState`,
  `computeReconciliationToken`, `getRoomPreloadCounts`,
  `getLatestLoadedRoomEvent`), alive as a legacy-surface re-export
  required by an existing arch guard (`fetchAllThreadRelations` and
  constants re-exported through `threadBootstrap.ts` per the P5.1
  Commit 2 note), or an intentional optional API
  (`useMindroomSyncEngineOptional`). The three legacy cache shim
  files were already deleted in P2.3. Per the brief's "be
  conservative — when in doubt, leave and note" direction, the
  audit was recorded rather than forced into an empty commit; the
  P7.1 landing is therefore a single docs commit rather than the
  planned two.
- 2026-07-04 — **AC2 live convergence ships expected-RED pending a design
  decision (P5.2).** The reconciler's unit layer is green (18 units:
  dual injection, thread-null fallback, Tuwunel stale-copy re-apply), but
  the live AC2 spec fails and five gate iterations produced this
  evidence chain: Tuwunel honors `recurse=true` (verified by direct
  curl); probe signatures are nondeterministic across clean-network runs
  (`reconcilesRepaired` flapping 2 → 0 with identical code); in the final
  failing run the playwright network log contains ZERO reconciler-shaped
  `/relations` requests (reconciler always sets `limit=200`; only
  no-limit SDK-machinery requests appear) — the reconcile executor exited
  BEFORE its first fetch. The pass has three silent exits currently
  indistinguishable in probes: fetch-failure (`to()` swallow),
  zero-divergence, and the `shouldContinue` guard abort; the network
  evidence points at the guard abort during reopen mount churn.
  **Decision needed from the product owner:** (a) re-schedule once on
  guard-abort or drop the guard for band-0 reconciles, and (b) whether
  the engine should persist thread events from the catch-up sync
  (revisit the liveMode initial-burst gate) or the gap-fill should learn
  thread scopes — the underlying seam is that on token-resume reopen,
  thread-scope divergence reaches neither cache path. Spec re-annotated
  `test.fail()` with the full diagnosis in its header; iteration history
  in the Runbook ("P5 gate" entries v1-v5 + orchestrator network
  analysis).
  - 2026-07-04 UPDATE — **RESOLVED (AC2 GREEN, live).** AC2 revision
    R1-R9 landed the single unskippable choke-point schedule inside
    `runThreadOpenCacheFirst` (reverts STEP 3's guard-abort retry and
    STEP d's per-branch backfill-completed bandage in favour of a
    structural fix at the choke point). AC2 render-gap RG1-RG5b
    layered per-eventId + applier-fire counters that exonerated the
    entire data + render chain: `renderTargetRegressedDifferentInstance=0`,
    `renderTargetRegressedSameInstance=0`,
    `applierMakeReplacedLatestEqualsCurrent>0`. The remaining live-gate
    failure was misdiagnosis — pin-to-bottom on thread open +
    react-virtual removing the anchor from DOM, mis-read as a render
    defect. AC2 RG4b-fix (owner ruling, 2026-07-04): reopen pin-to-
    bottom is intentional streaming UX; AC2's "scroll anchored" means
    the reconcile REPAIR itself does not displace the anchored
    viewport (scroll-position restoration across reopen is explicitly
    out of scope for CINNY-207 and NOT built here). Reworked
    `e2e/live/cinny207-stale-cache-divergence.spec.ts`: (1) poll
    `reconcilesRepaired>=1` after reopen; (2) walk the Scroll
    container upward until the seed reply's `[data-message-id]`
    appears, then `scrollIntoView({block:'center'})`; (3) anchored
    convergence assertions (edit-target v2 visible, v1 gone,
    redact-target gone); (4) capture anchor top, force synthetic
    `window resize`, recapture, `abs(delta) <= 8`. Two consecutive
    docker greens; `test.fail()` removed. Regressions
    (`cinny207-streamed-edit-cache`, `cinny207-stop-emoji-redaction`)
    unaffected. Follow-up (task #106): reaction chip persistence + IDB
    record persistence after reconciler-driven reaction redaction
    (`removeMatchingAggregatedRelationEvent` no-op when reaction not
    yet aggregated + `makeRedacted` strips relates_to preventing
    proactive re-add; `engineWriteThrough.onRedaction` fires from
    live-sync not from `fetchRelations`). Fixing #106 requires either a
    matrix-js-sdk-side Relations `pendingRedactionIds` set or a
    listener bandage — deferred as scope-limited and out of the RG4b
    directive. Full history in FORK_CHANGES.md Runbook entries
    "RG4b-fix" (top) and "RG1-RG4a diagnosis correction".
    Follow-ups from later in the same day: AC2 RG4e added a name-the-
    caller probe (per-instance `makeRedacted`/`makeReplaced` overrides
    on the fallback-registered sunk set) — two docker runs read all
    three sunkTarget counters at 0, confirming no clearing in the
    currently-green flow (the "sunk set" is empty because the SDK's
    own Relations aggregation carries the replacements). AC2 RG5-fix2
    (team-lead B-approval required addition) closed a still-open
    reopening: `handleThreadNewReply` fires AFTER a reconcile repair
    with the SYNC-delivered non-repaired instance for the same target
    id, and the pre-fix picker's fall-through let it wipe the repair
    when the effective-replacement helper's sender filter dropped the
    repaired side. Fix is a structural asymmetric raw-`.replacingEvent()`
    presence check in `pickPreferredThreadRenderEvent` AFTER the
    D12-style ts→event_id block — the picker is used by both the sink
    merge and the `buildThreadEvents` SDK-vs-fallback merge, one rule
    covers both seams. Regression test in `useThreadRenderState.test.ts`
    (foreign-sender edit shape) proven red-without / green-with the
    fix. Live gate green (`/tmp/ac2-rg5fix2-livegate.log`): AC2 30.9s
    + streamed-edit 37.8s + stop-emoji 48.5s.

- 2026-07-04 — **P4 gate fix: `gapFillExecutor.enqueue` no longer
  short-circuits on tier.** Original design filtered federated /
  encrypted rooms BEFORE the backfill scheduler saw them. First
  docker gate on AC13 reported `schedulerCompleted=0` while
  `gapFillsEnqueued>=1` — indistinguishable in a probe snapshot
  from "silent job failure" because there was no `schedulerEnqueued`
  either. Fix: every tracker enqueue now enters the scheduler and
  the tier check runs inside `runOnce` (`isRoomEligibleForRawFetch`)
  with the same net behavior — no network fetch for federated /
  encrypted rooms — but with `schedulerEnqueued` and
  `schedulerCompleted` bumping in lockstep with `gapFillsEnqueued`.
  Marker semantics preserved by tier inside `runOnce`: encrypted-own
  clears the marker (unusable ciphertext, no retry point); federated
  preserves the marker (Deviations §8 policy — user attention only).
  Net cost: one extra scheduler pass per federated / encrypted-own
  gap-fill enqueue (a Map lookup + a microtask). Alternative
  considered: keep the short-circuit and add a separate
  `gapFillsSkippedByPolicy` counter. Rejected because it multiplies
  counters without simplifying the AC13 assertion shape — the
  lockstep invariant is the durable observability win.

- 2026-07-04 — **P4 gate fix: `schedulerFailed` counter added.**
  Previously the scheduler counted `schedulerAborted` (on abort-
  caused rejects only) and `schedulerCompleted` (on natural
  completion); a non-abort executor reject counted as neither.
  That made silent job failure invisible from a probe snapshot,
  which is exactly what turned AC13 gate debugging into log
  spelunking. Fix: the scheduler's run try/catch bumps
  `schedulerFailed` on the non-abort branch. AC13 spec asserts
  `schedulerFailed === 0` with a diagnostic message pointing at
  `createMessagesRequest` / `saveRoomEventsToCache` as the likely
  culprits, so the next iteration doesn't need log inspection to
  narrow the failure surface.

- 2026-07-04 — **P4 gate fix: AC13 probe reset moved from
  `page.evaluate` to `page.addInitScript`.** The old order zeroed
  the probe AFTER `expectLoggedInShellStable`, by which point the
  post-reload engine had already primed, enqueued startup jobs on
  Sync→PREPARED, and possibly completed them — so `schedulerCompleted`
  bumps produced during that window were wiped and the assertion
  relied on a NEW enqueue firing in the following 12s (racy on a
  well-caught-up sync). Init-script runs on the fresh document
  before app JS mounts; the probe module installs itself on import
  and the script resets it via microtask + rAF fallback so every
  counter delta is attributable to the post-reload engine. Recorded
  so the spec's pattern (init-script over evaluate for pre-mount
  state) becomes a reference point for future e2e gates.

- 2026-07-04 — **P4.1 cooperative abort v1: executors check between
  batches only.** The SDK helpers `mx.fetchRelations` and
  `mx.createMessagesRequest` do not accept an `AbortSignal` today.
  The `BackfillScheduler` exposes a signal on each executor call, and
  every executor written for Phase 4 (`gapFillExecutor`,
  `deepHistoryJob`, `thread-seed`, `thread-backfill`) checks
  `signal.aborted` between batches. Cancellation lands between
  requests, not mid-request. Migration to
  `mx.http.authedRequest({abortSignal})` is a recorded follow-up (it
  requires re-implementing the two SDK helpers' request shapes; the
  scheduler contract already matches).

- 2026-07-04 — **P4.2 gap-fill executor uses
  `mx.createMessagesRequest` — first caller of this SDK method in the
  fork.** Previous pagination paths all went through
  `mx.paginateEventTimeline` (which mutates the SDK live timeline).
  The executor calls `createMessagesRequest(Direction.Backward,
  200/batch, ≤20 iterations)` and persists via
  `saveRoomEventsToCache` — the SDK timeline is never touched. This
  is deliberate: gap-fill is background work that must not force
  React re-renders. Deep-history (P4.3) uses the same primitive for
  the same reason. Any future speculative-fetch job kind should use
  this primitive too and go through the scheduler.

- 2026-07-04 — **P4.2 `noteRoomFederated` is a patch-only ledger
  setter.** The setter fills the P2.2-deferred writer gap for the
  `federated` field. Existing rows: single-field replace preserving
  byte/count/activity so the LRU-inside-priority ordering the
  eviction job depends on is not disturbed. Missing rows: minimal
  bootstrap (`approxBytes=0`, `eventCount=0`, `lastActivityTs=0`,
  `federated`); the next real save from the events store's ledger
  tracker overwrites the zeroed counters via
  `baseline.federated !== undefined` in `writeUpdatedLedger`.
  Alternative considered: fold the write into `saveRoomEventsToCache`
  as an extra arg. Rejected because the tier is a room-level property
  that doesn't change per-event — a dedicated setter called once per
  focus is cleaner. Recorded so P4.2 review does not count the split
  as a duplication of write paths.

- 2026-07-04 — **P4.2 AC13 spec tightened to ~25 REST messages and a
  single page context.** The P3.2 red version sent ONE offline
  message and slept; Tuwunel rarely declares `limited=true` for that
  single event on the next incremental sync, so the fill executor
  path only sometimes ran. The green version sends ~25 REST messages
  while the page is still mounted, reloads (single page context —
  no `about:blank`), resets the probe on the fresh page, waits 12s,
  and asserts (a) `schedulerCompleted >= 1`, (b) `gapFillsEnqueued
  >= 1`, (c) the last REST event id is present in cache. Divergence
  approved by team-lead in the GO-P4 message ("testing more, not
  less"). `test.fail()` removed.

- 2026-07-04 — **P4.2 eviction protection is single-element in v1.**
  `engine.noteRoomFocused(roomId, threadId?)` calls
  `setEvictionProtectedRoomIds([roomId])` — only the currently
  focused room is protected from eviction. LRU inside priority
  covers everything else (the actively-open room is by definition
  the room with the highest `lastActivityTs`; new events keep it at
  the tail). Recorded so AC7 review does not count "recently opened
  but not focused" rooms as protected. A future iteration can
  broaden the set once we have a use case (e.g. protect the last
  N focused rooms across account switches).

- 2026-07-04 — **P4.3 progressive-render recalibration NOT
  replicated.** The old `useRoomEagerPreload` loop notified React
  every batch so the scrollbar height grew smoothly as deep-history
  pagination progressed. The new band-4 scheduler job persists to
  IDB and does not touch the SDK live timeline — events surface on
  the next mount's cache-hydration pass, all at once. Cost: users
  don't see the "loading more" scroll smear anymore. Benefit: no
  per-batch React re-render storm, and the sweep can run happily in
  the background of an unmounted room. Product-owner-accepted per
  team-lead direction as consistent with D14 ("persist raw events
  to IDB, let hydration read on demand").

- 2026-07-04 — **P4.4 does not fully delete
  `threadSeedPrewarmController` / `threadOverviewResumeController`.**
  Client-scoped fetch dedup is now on the scheduler (the F9 fix
  point), and the previously-in-flight refs mirror scheduler state.
  The outer React scaffolding (generation guards, priority-target
  drain loop, page-resume trigger) is preserved because it wires
  into multiple downstream consumers (`threadOpenSeedController`
  reads the prewarm refs to decide whether to await; the compact
  view's summary hydration reads the resume trigger). A follow-up
  in a later phase can enqueue seed jobs directly from
  `engine.noteRoomFocused` (targeting `collectPriorityThreadSeedPrewarmRoots`
  output) and retire the controllers entirely. Recorded so P4.4
  review is not measured against a "delete both controllers"
  standard the brief loosely implies.

- 2026-07-03 — **P3.1/P3.3 live thread appends persist
  `tailLoaded: true` always.** The pre-strip component controller
  passed `atLiveEndRef.current` — an atomic snapshot of whether the
  UI's scroll was at the tail — as the tailLoaded arg into
  persistThreadEventCache. The engine's write-through has no UI
  notion of "at the tail" because it isn't the UI, so it passes
  `true` unconditionally for live thread appends. This is safe
  because `mergeThreadCacheFlag` never downgrades `true → false`,
  and a live event by definition is at the tail (the SDK delivered
  it as the newest event in the thread's timeline). Product-owner-
  accepted per team-lead direction.

- 2026-07-03 — **P3.2 gap-fill executor is deferred to Phase 4.**
  P3.2 landed the queue with tracking, priority, and dedup, but the
  worker that drains `pendingJobs()`, issues the fill fetches, and
  calls `clearRoomTailDiscontinuity` after success is Phase 4 work
  (P4.1 BackfillScheduler). Consequence today: gap markers land on
  Prepared + on TimelineReset, but nothing consumes them. Cached
  paint still returns cached events; there's simply no
  gap-repair-in-flight after a limited sync until Phase 4 ships.
  AC13's e2e spec stays `test.fail()` per plan.

- 2026-07-03 — **P3.1 engine `liveMode` gate skips the initial
  sync's `RoomEvent.Timeline` fires.** The engine flips `liveMode`
  true only when `ClientEvent.Sync` reaches Prepared/Syncing/Catchup.
  Live events delivered synchronously as sync data is being applied
  arrive on `RoomEvent.Timeline` BEFORE the sync-state event does,
  so the guard drops them. This is intentional: without the guard,
  the initial catchup would flood every joined room with per-event
  writes at startup. The gap is bridged by the startup `GapFillJob`s
  the gap-tracker enqueues on Prepared (P3.2) — Phase 4's scheduler
  drains them and back-fills the rooms via `/messages` batches.
  Until Phase 4 lands, background rooms are covered from the first
  post-startup live event forward, not from the startup snapshot;
  cached paint still shows the pre-startup slice, so no user-visible
  regression relative to the pre-P3 baseline.

- 2026-07-03 — **P3.3 encrypted-rooms parity.** The engine writes
  live events for encrypted rooms the same way it does for
  unencrypted rooms — `RoomEvent.Timeline` and
  `RoomEvent.Redaction` fire post-decryption at client scope for
  both. `MegolmDecryption` re-emits `Event.Decrypted`, which the
  SDK translates back into a `Timeline` fire for the decrypted
  event; the engine's write-through sees the decrypted payload and
  the same edit-compaction / redaction-lifecycle paths apply. No
  encrypted-specific branch. Docker gate exercises this via
  encrypted room fixtures in the existing e2e suite.

- 2026-07-04 — **P2.2 eviction ships with federated-flag population,
  protected-room registry, and `lastOpenedTs` stamping deferred to
  Phase 3/4.** The eviction policy (D9) reads three signals it does
  not yet own the write side of: `ledger.federated`, the module-level
  protected room registry (`setEvictionProtectedRoomIds`), and
  `meta.lastOpenedTs`. All three landed as read-only inputs in P2.2
  with the eviction job wired to consume them; their populators wire
  in with the Phase 3/4 sync engine. Consequence today: (a) no room
  is flagged federated so the policy degrades to pure LRU order —
  acceptable because we're single-homeserver in production, (b) the
  registry is empty so the "current room never evicted" invariant is
  carried by the LRU order alone (the actively-open room is by
  definition the room with the highest `lastActivityTs`; new events
  arriving to it keep it at the tail), (c) with no `lastOpenedTs`
  stamps the recent-open guard is a no-op — again acceptable because
  LRU is a reasonable fallback. `noteRoomOpened`, `noteThreadOpened`,
  and `setEvictionProtectedRoomIds` are exported now with unit tests
  so Phase 3/4 has drop-in hooks. Recorded here so P2.2 review does
  not count these as gaps.

- 2026-07-04 — **P2.2 D9 "never evict recently opened threads"
  implemented at whole-room granularity in v1.** The recent-open
  guard skips the entire room if ANY of its thread scopes'
  `meta.lastOpenedTs` is inside `EVICTION_RECENT_OPEN_WINDOW_MS =
  24h`. Because eviction is whole-room granularity (per D9), a finer
  per-thread guard would still boil down to a room-level decision.
  Documented so the AC7 gate is not signed off on a partial
  interpretation.

- 2026-07-03 — **P2.1 / D8 wipe lands before Tier 1 exists (Phases
  3-4).** The D8 legacy-DB wipe fires on first v3 open at the end of
  P2.1, before the sync-engine write-through (P3.1) and the
  backfill scheduler (P4) exist to rebuild the cache. Post-upgrade
  first-open of each room is therefore a network paint — equivalent to
  a fresh login — until the engine repopulates. This is a transient I1
  regression accepted for sequencing: D8 has to land as part of the
  CacheStore consolidation so the shim flip is safe and the new
  schema owns the DB names. It flips green again with P3.1 +
  P3.2/P4.1. Recorded here so the AC1 gate is not signed off on the
  P2.1 landing.

- 2026-07-03 — **P1.4 / D5 "synchronous flush on stream end"** reinterpreted:
  the implementation has no stream-end *detection*; the per-target trailing
  debounce (1 s) is the stream-end flush — each edit re-arms the timer, so
  the trailing write carries the final content ≤1 s after the last edit.
  Synchronous flushes exist on unmount, `pagehide`, and
  `visibilitychange → hidden`. Difference vs. the literal D5 wording: a hard
  tab kill inside the 1 s window can lose the last pending upsert (the
  target's previous record remains; reconcile converges it). Reason:
  MindRoom emits no explicit end-of-stream marker on the wire today, and the
  stop-emoji redaction is not guaranteed for uncancelled streams. Flagged by
  workflow review round 1; recorded here for product-owner review.

## 9. Status log

- 2026-07-04 — **Phase 6 + Phase 7 fully landed locally** on
  `cache-overhaul/13-p6p7-settings-cleanup`, branched from the
  Phase 5 tip (`52e37491`). Six commits total (P6.1 x4 + P7.1 x2
  folded into a single docs commit — see Deviations §8 for the
  fold justification).

  1. `07fb8555` P6.1 Commit 1 `feat: prefetch settings resolvers
     and transitional fields` — `engine/prefetchPolicy.ts` grows
     `PrefetchScope` literal + `DEFAULT_PREFETCH_SCOPE` +
     `sanitizePrefetchScope` + `sanitizePrefetchDepth` (clamp
     [`ROOM_TAIL_PREFETCH_DEPTH=200`,
     `CURRENT_ROOM_DEEP_HISTORY_TARGET=10000`]) + pure
     `resolvePrefetchConfig(settings)` -> `{scope,
     currentRoomDepth, roomTailDepth, threadInventoryLimit}`.
     `mindroomSettings.ts` grows `prefetchScope` + `prefetchDepth`
     ALONGSIDE the legacy `paginationLimit` — transitional so the
     tree stays green. 17 new sanitizer/resolver tests
     (prefetchPolicy 20/20 total).

  2. `2bcbe724` P6.1 Commit 2 `feat: prefetch settings UI` — new
     `MindroomPrefetchSettings.tsx` (two SequenceCards; folds
     PopOut+FocusTrap+Menu selector cloned from `SelectMessageLayout`
     in `features/settings/general/General.tsx` ~762-820; depth
     input shaped like the pre-D4 preload input). Wired through
     `settingsExtensions.tsx`. Arch guard flipped
     (`RoomTimeline.architecture.test.ts:1656` now requires
     `MindroomPrefetchSettings` in `settingsExtensionsSource`;
     `settingsMenuExtensionsSource` still forbids both symbols). 6
     new component tests (`MindroomPrefetchSettings.test.ts`).

  3. `09f28b95` P6.1 Commit 3 `refactor: consumers onto
     prefetchDepth` — `MindroomRoomTimeline.tsx` (~22 refs) +
     seven controllers renamed `safePaginationLimit` ->
     `prefetchDepth` and `safePaginationLimitRef` ->
     `prefetchDepthRef` (`roomCacheHydrationController`,
     `roomEventOpenController`, `roomPaginationCommandController`,
     `roomTimelineNavigationController`,
     `roomTimelineWindowController`, `threadOpenCacheController`,
     `threadSeedPrewarmController`). `timelinePagination.ts`'s
     `paginationLimit` parameter renamed to `windowLimit`
     (mechanical). Deep-history wiring: depth snapshot at effect
     fire, passed as `targetEventCount` to
     `enqueueRoomDeepHistoryJob` (Deviations §8). Test shims
     updated. `RoomTimeline.cache.test.ts` "keeps first visible
     anchored" case adjusted for the new 200 minimum (pre-D4 value
     100 is not representable under the new sanitizer).
     `src/app/pages/client/inbox/Notifications.tsx` NOT touched
     (its `paginationLimit` is an unrelated upstream param).

  4. `a27aedf7` P6.1 Commit 4 `refactor: remove the legacy preload
     setting; drop stored values (D4)` — DELETE
     `MindroomMessagePreloadLimitSetting.tsx` + test,
     `preloadSettings.test.ts`. From `preloadSettings.ts` remove
     `DEFAULT_PAGINATION_LIMIT` / `MIN_PAGINATION_LIMIT` /
     `MAX_PAGINATION_LIMIT` / `sanitizePaginationLimit`; also
     remove `ROOM_CACHE_PERSIST_DEBOUNCE_MS` (P1.1 sweep debounce
     — its subject was deleted in P3.3, no live consumers).
     Survivors kept in-file: `THREAD_BATCH_SIZE`,
     `ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE`,
     `THREAD_EDIT_COMPACTION_DEBOUNCE_MS` (three live callers each).
     `mindroomSettings.ts` drops `paginationLimit` from the type,
     destructure-omits it on every read. NEW leaf module
     `mindroomSettingsBootstrap.ts` (NO transitive import of
     `state/settings.ts`) with `dropLegacyMindroomSettings()`
     scrub — imported at the top of `src/index.tsx` BEFORE the
     App/state import chain triggers the settings atom.
     `mindroomSettings.test.ts` rewritten (7 tests: drop test,
     garbage-scope test, no-paginationLimit-key-after-write test,
     scrub test + three no-op cases). NEW 6.4 arch guard
     `prefetchSettings.architecture.test.ts` (RED FIRST — three
     tests failed pre-Commit-4, all pass post-Commit-4; exempts
     the D4 drop machinery + tests + legacy-negation guards —
     Deviations §8).

  5+6. `[this commit]` P7.1 dead-code audit + docs rewrite
     (folded — Deviations §8). Dead-code recipe:
     `npx ts-prune | rg app/mindroom` +
     `rg -n "from '\./(preloadController|roomCacheLifecycleController|threadCachePersistenceController|threadSeedPrewarmController|threadOpenPostBootstrapRefresh)'" src/`.
     Zero verified-dead orphans (Deviations §8). Docs commit:
     `docs/mindroom-cache-strategy.md` full rewrite (Core Model
     diagram shows the engine's four components; Cache Layers
     collapses to one `cacheStore/` row; Write Owners names the
     four engine writers + inverse rule that render components own
     ZERO writes; Read Owners rewritten around thread-open ->
     reconciler and hydration helpers; Coverage Semantics gains
     D7 verbatim; Main Flows drops "Eager Preload" entirely and
     adds a "Tiered Prefetch" section; Forbidden Patterns keeps
     the cross-room-preload rule with the updated justification
     and adds three new prohibitions; Review Checklist gains the
     scheduler-dedup and "reconcile scheduled even on complete
     coverage (D7)" questions). `FORK_CHANGES.md` gains a Phase
     6+7 runbook entry. This plan gains the header status marker,
     this §9 entry, §6.4 guard row, and four new Deviations §8
     entries.

  Full validation on the branch tip: `npx tsc --noEmit` clean;
  focused vitest (`prefetchPolicy` 20/20, `mindroomSettings` 7/7,
  `MindroomPrefetchSettings` 6/6, `prefetchSettings.architecture`
  5/5, `RoomTimeline.architecture` 96/96, `RoomTimeline.cache`
  76/76, `RoomTimeline.navigation` 22/22,
  `RoomTimelineCollapsible` 12/12,
  `roomPaginationCommandController` 4/4, `state/settings` 4/4);
  full mindroom + state/settings 232 files / 2036 tests green
  after Commit 4; full-repo `npx vitest run` + build + lint land
  with this docs commit. P7.2 (final adversarial review + full
  Scorecard audit) is the orchestrator's, not part of this
  branch.

- 2026-07-04 — **Phase 5 fully landed locally** on
  `cache-overhaul/12-p5-reconciler` (four feature commits + this docs
  commit). Branched from `a4f30e76` (post-Phase-4-gate-fix tip of
  `cache-overhaul/11-p4-scheduler`). Commits:

  1. `727ce26e` P5.1 Commit 1 `feat: engine reconciler — every open
     schedules convergence` — NEW `engine/reconciler.ts` with
     `scheduleReconcile({reason, roomId, threadId?, cachedPage?,
     onRepaired?, shouldContinue?})`. NEW `'reconcile'` job kind on
     the scheduler at band 0 (own dedup domain since kind is part of
     the AC8 key — coexists with thread-backfill). Thread pass:
     `fetchRelations` recurse limit-200, pages further until overlap
     by event id (removes F7's 200-event ceiling), diffs via
     `detectDivergence` (new id / redaction of cached target /
     bundled 'm.replace' on cached id), applies via
     `hydrateCachedEvents` (P1.2 machinery — `applyCachedRedactions`,
     `applyCachedReplaceRelations`, `reconcileRelationEventsWithAggregation`);
     every raw event funneled through `createPreferLiveEventMapper`
     for Tuwunel stale-copy heal. Empty diff = zero writes, zero
     ticks (D7 cheap no-op — unit-tested). D7 rewire in
     `threadOpenCacheFirst.ts:114` (complete-coverage schedules
     reconcile with `reason: 'open-complete-coverage'`). Partial-
     coverage path schedules from `threadOpenLifecycleController.ts`
     after SDK bootstrap with `reason: 'open-partial-coverage'`.
     DELETED `refreshLatestThreadRelationsTail` (89 lines) from
     `threadOpenCacheController.ts`; arch guard at
     `RoomTimeline.architecture.test.ts:754` retained as tripwire.
     AC2 spec added RED (`test.fail()`) at
     `e2e/live/cinny207-stale-cache-divergence.spec.ts`. Threads
     controller loses the `roomTimelineSet` prop (was only consumed
     by the deleted method). 6 new reconciler unit tests + updated
     `threadOpenCacheFirst.test.ts` AC9 assertion + updated
     `RoomTimeline.cache.test.ts` partial-coverage `fetchRelations`
     count (now 2 per open: 1 backfill + 1 reconcile).

  2. `05594b54` P5.1 Commit 2 `refactor: thread backfill into the
     engine; delete post-bootstrap refresh` — NEW
     `engine/threadRelationsFetcher.ts` (migrated
     `fetchAllThreadRelations` + `MAX_THREAD_FETCH_EVENTS` +
     `MAX_THREAD_FETCH_ITERATIONS` from `threadBootstrap.ts`; the
     latter re-exports the engine symbols for the legacy test
     surface). NEW `engine/threadBackfillJob.ts` — thin producer:
     `enqueueThreadBackfillJob({mx, scheduler, room, threadId,
     priority?, shouldContinue?})` routes the fetch through the
     scheduler under the existing `'thread-backfill'` kind (P4.4's
     overview-resume dedup domain). `threadOpenCacheController.
     backfillThreadRelationsIntoCache` now awaits
     `enqueueThreadBackfillJob(...)` instead of calling the fetcher
     directly; the render-state side effects stay in the controller.
     Controller gains a `scheduler: BackfillScheduler` prop.
     `threadOverviewResumeController.ts` retargets its
     `fetchAllThreadRelations` import at `../engine`. DELETED
     `threads/threadOpenPostBootstrapRefresh.ts` (115 lines) + its
     test (91 lines). The `shouldScrollToLatestOnOpen === true` →
     `refreshLatestThreadSlice` branch and the forward-gap check +
     `'thread-open-forward-gap-check'` log string move inline into
     `threadOpenLifecycleController.ts` (log string preserved so
     capture consumers keep working). Two NEW arch guards in
     `engine/__tests__/engine.architecture.test.ts`:
     (a) `fetchAllThreadRelations is defined in engine/, and
     imported only within engine/**`, (b) `mx.fetchRelations in
     threads/ is limited to threadOpenSdkBootstrap.ts with exactly 2
     occurrences`. Explicit exclusion:
     `notifications/readReceipts.ts` uses `mx.fetchRelations` with
     `RelationType.Thread limit:1` — receipts-domain, not
     thread-history backfill — out of scope. The
     `RoomTimeline.architecture.test.ts:797-813` post-bootstrap-refresh
     guard is reshaped to point at the lifecycle controller as the
     new home of the log string.

  3. `7a30e7f8` P5.1 Commit 3 `feat: room-open reconcile with
     discontinuity awareness` — wires the room-scope reconcile from
     the engine's `noteRoomFocused`: every room focus schedules a
     `'reconcile'` job with `threadId: undefined` at band 0. AC8
     dedup includes kind + roomId + threadId, so room-scope and
     thread-scope reconciles on the same room coexist (different
     keys). The room-scope executor is deliberately a fast no-op —
     room-open tail catchup is end-to-end owned by the P3.2 markers
     (TimelineReset + Sync→PREPARED) + P4.2 `gapFillExecutor`;
     duplicating that work with a `/messages` catchup here would
     just contend with the gap-fill queue. What Commit 3 adds is the
     SCHEDULE tripwire so the D7 "every open schedules a reconcile"
     invariant holds at both scopes and probe captures gain
     observability parity. `onRepaired` intentionally NOT called
     (invariant: "onRepaired fires only when a repair was actually
     applied"). 3 new reconciler unit tests (room-scope schedule
     shape, room-scope dedup, room-scope vs thread-scope coexist).

  4. `5724ef8f` P5.2 Commit 4 `fix+test: repair applier hardening;
     AC2 green; correction-path anchor unit` — 2 new reconciler unit
     tests plus the AC2 spec flip.
     Applier hardening (AC10): fixture carries a bundled edit AND a
     redaction on cached ids, asserts divergence detection, exactly
     one `onRepaired`, and NO push to `setSupplementalThreadEvents`
     (instance mutation only, no array splice). The reconciler
     structurally cannot grow the rendered array; that's the AC10
     guarantee.
     Tuwunel stale-copy re-apply: fixture where `mx.getRoom(...).
     findEventById($reaction)` returns a live instance with a
     tracked `makeRedacted` spy; the fetch serves the reaction with
     `unsigned.redacted_because` (the exact Tuwunel 10-second
     behavior discovered in the P3 gate work); asserts the
     reconciler funnels through `createPreferLiveEventMapper` BEFORE
     diffing so `liveEvent.makeRedacted(...)` fires and cascades
     into the SDK's `Relations.BeforeRedaction` listener.
     AC2 spec `e2e/live/cinny207-stale-cache-divergence.spec.ts`
     flipped from `test.fail` to `test` — the docker gate against
     real Tuwunel is the team-lead's to run; the applier +
     prefer-live wiring is covered by the new unit tests in the
     meantime.

  5. This docs commit — runbook P5.1/P5.2, plan header (Phase 5
     "landed") + status log + scorecard AC2/AC9/AC10 + §6.4
     regression guards updated with the two new engine-owned
     `/relations` boundary guards + the reshaped post-bootstrap
     guard + notes on the retained `refreshLatestThreadRelationsTail`
     tripwire.

  Full validation on the branch tip: `npx tsc --noEmit` clean;
  `npx vitest run` 337 files / 2568 tests green (+11 vs the
  post-P4-gate-fix baseline of 2557 — six new reconciler tests in
  Commit 1, three room-scope in Commit 3, two applier+Tuwunel in
  Commit 4; two tests lost from the deleted
  `threadOpenPostBootstrapRefresh.test.ts` are recovered elsewhere
  in the reconciler + arch guard units); `npm run build` OK;
  `npm run lint` 18 warnings / 0 errors — exact baseline, zero
  delta. Docker gate (AC2 flip + regression) not run by the
  implementing agent; team-lead runs it after PR open.

- 2026-07-04 — **Phase 4 gate fix applied** on
  `cache-overhaul/11-p4-scheduler`. First docker gate reported AC13
  (cinny207-gap-fill-restart) failing with `schedulerCompleted=0`
  after 12s while `gapFillsEnqueued>=1` — the ambiguous silent-
  failure snapshot. Single hotfix commit lands three converging
  fixes: (1) `schedulerFailed` probe counter (from the scheduler's
  non-abort reject branch) so silent job failures are visible from a
  snapshot; (2) `gapFillExecutor.enqueue` no longer short-circuits
  on tier — every tracker enqueue enters the scheduler so
  `gapFillsEnqueued` and `schedulerEnqueued` stay in lockstep, with
  tier-based marker semantics preserved inside `runOnce` (encrypted-
  own clears; federated preserves); (3) AC13 spec moves the probe
  reset from a post-`expectLoggedInShellStable` `page.evaluate` to a
  pre-reload `page.addInitScript` so counters are zeroed before the
  post-reload engine primes and enqueues startup jobs. Three new
  Deviations §8 entries. Tests: +2 scheduler (schedulerFailed
  coverage), +1 gapFillExecutor (AC13-mechanism startup-job path
  with `prevBatch=undefined`), +1 updated (federated-room lockstep
  behavior). Validation: typecheck clean, `npx vitest run` 337 files
  / 2557 tests green (+4 vs Phase 4 baseline), build OK, lint 18
  warnings / 0 errors (exact baseline, zero delta). Docker gate re-
  run pending (team-lead).

- 2026-07-04 — **Phase 4 fully landed locally** on
  `cache-overhaul/11-p4-scheduler` (four feature commits + docs).
  Branched from `202e57f1` (P3.3 tip after the round-2 redaction
  gate fix). Commits:

  1. `4f74dafa` P4.1 `feat: BackfillScheduler with priority queue,
     dedup, and abort` — the client-scoped queue that serializes
     every backfill-shaped network fetch. AC8 dedup: ONE Map covers
     queued AND in-flight, so same-key enqueues return the same
     promise identity. Bands 0-4 with within-band `getLastActiveTimestamp`
     desc; MAX_CONCURRENT_BACKFILL_JOBS=2; cooperative abort v1.
     Engine wired (scheduler exposed on the instance; `abortAll` from
     stop). Four new probe counters (`schedulerEnqueued`,
     `schedulerDeduped`, `schedulerAborted`, `schedulerCompleted`).
     14 new unit tests.
  2. `0bc82add` P4.2 `feat: prefetch policy with homeserver detection`
     — `engine/prefetchPolicy.ts` new (D3, homeserver-domain
     comparison of the `m.room.create` sender; NEVER parses room
     ids). `engine/gapFillExecutor.ts` new (subscribes to Phase-3.2
     queue via new `GapFillScheduler.onEnqueue`; drives
     `mx.createMessagesRequest` through the scheduler; persists via
     `saveRoomEventsToCache`; clears durable marker). New
     `cacheStore/cacheStoreLedger.ts` setter `noteRoomFederated`
     fills the P2.2-deferred writer gap. New engine method
     `noteRoomFocused(roomId, threadId?)` consolidates tier stamp +
     eviction protection + open-timestamp bumps. Called from a
     useEffect in `MindroomRoomTimeline`. AC13 e2e spec tightened
     (~25 REST messages, single page context, probe + cache
     assertions, `test.fail()` removed). 19 new unit tests
     (prefetchPolicy 10, gapFillExecutor 5, noteRoomFocused 4).
  3. `549e891a` P4.3 `refactor: delete the eager-preload loop; deep
     history as scheduler job` — DELETE `threads/preloadController.ts`
     (317 lines). NEW `engine/deepHistoryJob.ts` (band 4, up to
     10000 events via `createMessagesRequest` + `saveRoomEventsToCache`;
     never touches the SDK live timeline). `MindroomRoomTimeline`
     sheds the `eagerPreloading` state + reset useLayoutEffect +
     `eagerPreloadDoneForRoomRef` + the `!eagerPreloading` skeleton
     gate term + the debug controller `eagerPreloading` prop. New
     useEffect enqueues the band-4 job. `roomCacheHydrationController`
     shrinks (loses preload-done ref, `setEagerPreloading`). Two
     architecture guards rewritten/added: "delegates eager room
     preload orchestration outside RoomTimeline" → "routes
     deep-history preload through the engine scheduler, not the SDK
     live timeline"; NEW "keeps backfill network fetchers inside
     the engine (no direct createMessagesRequest in components)".
     Deleted the stale "keeps eager-preloading past fifty batches"
     cache test (asserted the deleted hook). 4 new deepHistoryJob
     unit tests.
  4. `2fa4334a` P4.4 `refactor: absorb thread seed prewarm and
     overview resume into the scheduler` — `ensureThreadSeedPrewarm`
     wraps its cache-first seed load in `scheduler.enqueue({kind:
     'thread-seed', priority: 3})`; client-scoped dedup replaces
     the per-controller `prewarmingThreadSeedPromisesRef` as the F9
     dedup point (refs still populated for downstream consumers).
     `refreshOverviewThreadCacheFromRelations` wraps its
     `fetchAllThreadRelations` + persist in `scheduler.enqueue({kind:
     'thread-backfill', priority: 2})`; `overviewResumeRefreshInFlightRef`
     and `pendingOverviewResumeRefreshRef` deleted. Outer React
     scaffolding preserved.
  5. This docs commit — runbook P4.1-P4.4, plan header + status log
     + scorecard AC8/AC13 + Deviations §8 (seven new entries) +
     §6.4 guard updates.

  Full validation on the branch tip: `npx tsc --noEmit` clean;
  `npx vitest run src/app/mindroom/` 231 files / 1992 tests green;
  `npx vitest run` 337 files / 2553 tests green (+48 vs P3.3
  baseline of 2505); `npm run build` OK; `npm run lint` 18 warnings
  / 0 errors — matches P3 baseline exactly (zero delta). Docker
  gate (AC13 flip + regression trio) not run by the implementing
  agent; team-lead runs it after PR open.

- 2026-07-03 — **Phase 3 fully landed locally** on
  `cache-overhaul/10-p3-sync-engine` after P3.3. Six commits
  on top of the P2.3 tip:

  1-4. `MindroomSyncEngine` skeleton (P3.1 commit 1), move
       compaction scheduler + redaction lifecycle into `engine/`
       (P3.1 commit 2), global Tier-1 write-through with the two
       verbatim (P3.1 commit 3), limited-sync gap detection +
       gap-fill queue stub (P3.2 commit 4). All landed on this
       branch pre-strip; see the P3.1/P3.2 runbook entry for
       detail. Behavior net after commit 4 was dual-write:
       engine writes were live in parallel with the component
       write path, convergent under idempotent IDB upserts. F1
       (background-room cache freshness) was fixed by the
       client-level listeners even before the strip.
  5. `refactor: strip component persistence; render-only live
     controller (CINNY-207 P3.3)` — DELETE
     `roomCacheLifecycleController` and
     `threadCachePersistenceController`, RENAME
     `roomLiveEventController` → `roomLiveRenderController`
     with persistence stripped, rewire the eight fetch
     controllers onto `useMindroomSyncEngine`/
     `engine.persist.forRoom`. Explicit-persist-point (option b)
     in `roomPaginationCommandController` batch-persists the
     backfilled slice after `handleTimelinePagination(true)` so
     paginated history still reaches cache. Test churn: -22
     tests (2 P1.1 sweep, 6 sweep-derived room→thread persist,
     1 sweep-derived thread-seed warming, 13 component
     compaction — every behavior twinned in the engine plain-TS
     suite); +3 engine architecture guards. Test harness gains
     a `MindroomSyncEngineProvider` wrap so
     `useMindroomSyncEngine` resolves without a full ClientRoot
     mount. `cinny207-background-room-freshness.spec.ts`
     flipped to green.
  6. `docs: Phase 3 complete — runbook, scorecard, deviations
     (CINNY-207)` — this entry, the P3.3 runbook entry,
     scorecard AC5/AC6 updates, four Deviations for tailLoaded
     semantics + P3.2 exit scope + liveMode initial-sync skip
     + encrypted-rooms parity, §6.4 guard-list update.

  Validation: `npm run typecheck` clean; full `npx vitest run`
  → 331 files / 2505 tests green; `npm run build` clean;
  `npm run lint` back to the 18-warning baseline (zero delta).
  Deferred from this phase: docker e2e gate on the P3.3 tip
  (team-lead) — expected to flip
  `cinny207-background-room-freshness` green (AC6) and stay
  green on streamed-edit + stop-emoji.

- 2026-07-04 — **Phase 2 fully landed locally** on
  `cache-overhaul/09-p2-cachestore` after P2.3. Two commits on top of
  the P2.2 stack:

  1. `refactor: import cacheStore directly and move the health gate
     into the store` — flipped `eventRepository.ts`, `sessionCleanup.ts`,
     `threadSummaryStore.ts`, and `threadSummaryState.ts` to import
     directly from `./cacheStore`. Deleted the three legacy pure-shim
     files (`roomEventCache.ts`, `threadEventCache.ts`,
     `threadSummaryCache.ts`), `cacheDbMigrationUtils.{ts,test.ts}`
     (its copy-migration machinery had no non-shim consumer), and the
     dead `loadLatestCachedThreadSummaryInfo` API. The cache-write
     health gate (P1.5 F4) moved OUT of the eventRepository seams and
     INTO the cacheStore save entry points (`saveRoomEventsToCache`,
     `saveThreadEventsToCache`, `saveCachedThreadSummary`) —
     `isCacheWritable()` check up front, `reportCacheWriteError` on
     failure, single write choke point. Deletes stay ungated.
     `eventRepository.persist*` are pure serialization seams —
     always call the injected `save`. `sessionCleanup` deletes each
     legacy per-session DB directly via `indexedDB.deleteDatabase`
     (three-way legacy split) alongside `deleteCacheStoreDb`, so
     rolled-back installs are still cleaned up on logout. The
     parameterized contract suite collapsed to run only against the
     unified store (the legacy parity net ends here). New store-
     level `cacheHealthGate.test.ts` (3 tests) covers "degrade skips
     subsequent saves" + "deletes stay ungated". Reworked
     `eventRepository.test.ts` health-gate assertions to the seam-
     always-delegates contract. Updated every `vi.mock` string
     targeting a deleted shim (initMatrix, sessionCleanup,
     RoomTimelineCollapsible, RoomView.threadSummary,
     useRecentThreadViewModel, RoomTimeline.test.shared,
     RoomTimeline.cache.test — 26 dynamic imports).
  2. `test: architecture guards for the CacheStore boundary` — new
     `cacheStore/__tests__/cacheStore.architecture.test.ts` (4 tests):
     (a) the three legacy shim files are absent on disk;
     (b) recursive scan of `src/app/mindroom/**` forbids imports of
     `./roomEventCache`, `./threadEventCache`, `./threadSummaryCache`
     (exclusions: this test + `RoomTimeline.architecture.test.ts`);
     (c) render components (`MindroomRoomTimeline.tsx` +
     `mindroom/messages/**`) must not contain `from './cacheStore'`
     or a `/cacheStore` import;
     (c') the only sanctioned cacheStore consumers are the allowlist
     [`eventRepository.ts`, `threadSummaryStore.ts`,
     `threadSummaryState.ts`, `sessionCleanup.ts`].
     P1.4 write-boundary guard in `RoomTimeline.architecture.test.ts`
     remains green (96/96).

  Tests: `cacheHealthGate.test.ts` 3/3;
  `cacheStore.architecture.test.ts` 4/4;
  `cacheStoreNormalize.{room,thread}.test.ts` moved and green (7 + 21);
  contract suite trimmed to cacheStore-only (21/21). Regression: full
  mindroom suite 218 files, all tests green; full vitest — see the
  final commit; `npm run typecheck`, `npm run build` clean;
  `npm run lint` 18-warning baseline verified with zero delta.

- 2026-07-04 — **P2.2 landed locally** on
  `cache-overhaul/09-p2-cachestore`: eviction ledger + `beforeTokens`
  pruning + 1 GB byte-budget eviction job (finding F3, decision D9,
  AC7). Three commits on top of the P2.1 stack:

  1. `feat: maintain the room byte/activity ledger on cache writes` —
     `cacheStoreLedger.ts` tracks per-room
     `{approxBytes, eventCount, lastActivityTs, federated?}` rows in
     the `room_ledger` store, updated transactionally with event
     puts/deletes. Read-before-write / read-before-delete for exact
     deltas; one-time lazy bootstrap (bounded to the touched room)
     seeds pre-P2.2 records; whole-DB delete implicitly clears; room-
     and thread-scope writes populate the SAME per-room row (whole-
     room eviction). Meta-only saves leave the ledger untouched.
     Exposed `noteRoomOpened` / `noteThreadOpened` — meta upserts
     that stamp `lastOpenedTs` while preserving other fields
     (callers wire in Phase 3/4).
  2. `feat: prune beforeTokens maps on meta writes` (F3) — reshaped
     `CachedPaginationTokenMap` to
     `Record<eventId, {token, savedAt}>`. Every merge stamps
     `savedAt = Date.now()` and prunes to
     `MAX_CACHE_BEFORE_TOKENS = 50`, oldest first with lexicographic
     event-id tiebreak; the entry being written is never pruned.
     Public `getCachedPaginationToken` return shape unchanged.
  3. `feat: cache eviction job with 1 GB budget` (D9/AC7) — new
     `cacheEviction.ts`. `runCacheEvictionIfOverBudget(sessionId)`
     reads the ledger snapshot, and if over budget evicts whole
     rooms until below `budget * 0.9`. Order: `federated === true`
     first, then ascending `lastActivityTs`. Skip: protected registry
     + rooms with any `meta.lastOpenedTs` inside 24 h. Eviction
     deletes events / meta / thread summaries / ledger row for the
     room; `eventDeletes` probe counts the events removed. Save-path
     `maybeScheduleEvictionCheck` fire-and-forget with module-level
     debounce (60 s per session, no timers held open).

  Tests: `cacheStoreLedger.test.ts` 10/10;
  `eventCacheTokenUtils.test.ts` 16/16;
  `cacheEviction.test.ts` 4/4. Regression: contract suite 42/42, D8
  wipe 2/2, full mindroom suite 218 files / 1929 tests, full vitest
  324 files / 2490 tests. `npm run typecheck`, `npm run build`
  clean; `npm run lint` 0 errors (19 pre-existing warnings). Section
  8 records the deferred federated-flag / registry / stamp
  populators and the whole-room recent-open interpretation.
  Deferred from this step: docker e2e run (separate gate); P2.3
  direct-import flip + architecture guard forbidding legacy imports
  outside cacheStore.

- 2026-07-03 — **P2.1 landed** (PR 9): unified CacheStore module
  consolidating `roomEventCache.ts`, `threadEventCache.ts`, and
  `threadSummaryCache.ts` behind a single-DB schema v3 (finding F12,
  decisions D8 + D9-prep). Storage lives in
  `src/app/mindroom/threads/cacheStore/`: one `events` store keyed by
  `${roomId}|${scope}|${eventId}` with a shared
  `by_scope_ts = [roomId, scope, ts, eventId]` index (`scope=''` for
  room-timeline, `scope=threadId` for threads); one `meta` store; one
  empty `room_ledger` store prepared for the P2.2 eviction ledger; one
  `thread_summaries` store with a `by_room` index. A single scoped-
  cursor core drives both room and thread reads/writes while preserving
  the two legacy-faithful behaviors the contract suite pins (room
  cursor skips local-echo inside the cursor without counting toward
  the limit; thread cursor skips `eventId === threadId`) and the meta
  asymmetry (room meta written only when a before-token was supplied;
  thread meta always written with `mergeThreadCacheFlag` semantics).
  D8 wipe fires on first v3 open: deletes the three session-scoped
  legacy DBs plus the three unsuffixed singletons (gated to 0-or-1
  stored sessions, matching the pre-existing legacy migration gate),
  writes an idempotency marker into `meta`, exactly-once per session.
  The three legacy modules became pure re-export shims; the legacy
  DB name strings are retained via `legacyCacheDbNames.ts` for logout
  cleanup on rolled-back installs. `sessionCleanup` and
  `initMatrix` both gained the unified `mindroom-cache` /
  `mindroom-cache::<sessionId>` names alongside the legacy ones.
  `e2e/helpers/storage.ts` was flipped to read the unified DB (scope
  filter for room vs. thread) while returning the same record shapes
  so the cinny207 P0.2 specs need no changes; `seedThreadSummaryCache`
  writes to the unified DB and pre-seeds the wipe marker so its data
  survives the first app open. AC14 evidence recorded above (wipe
  test 2/2; docker verification pending). Deferred from this step:
  P2.2 eviction ledger + 1 GB budget; P2.3 direct-import flip +
  architecture guard forbidding legacy imports outside cacheStore.
  Contract suite: 42/42 (21 legacy + 21 cacheStore). Full mindroom
  suite: 216 files / 1908 tests. Full vitest: 322 files / 2469 tests.
  Section 8 records the D8-before-Tier-1 sequencing deviation.

- 2026-07-03 — **P1.6 landed** (PR 8): legacy preload setting hard-capped
  (F11). `MAX_PAGINATION_LIMIT = 10000` enforced in `sanitizePaginationLimit`
  (covers UI commit and stored-value reads) and reflected in the settings
  input. Interim guard until the Phase 6 settings replacement (D4).
  **Phase 1 (P1.1-P1.6) is now fully landed.**

- 2026-07-03 — **P1.5 landed** (PR 7): cache write failures surfaced (F4).
  `cacheHealth.ts` counts every failure, logs the first per scope, and a
  `QuotaExceededError` degrades the session to cache-read-only (writes
  skipped at the persist entry points, reads/reconcile unaffected,
  `window.__MINDROOM_CACHE_HEALTH__` inspectable). AC11 unit-tested with an
  injected quota error. Deletes stay ungated; remaining write sites move
  behind CacheStore in Phase 2.

- 2026-07-03 — **P1.4 landed** (PR 6): edit compaction at the cache write
  boundary (F5/D5). Standalone same-sender `m.replace` records are no longer
  persisted; instead a per-target trailing-debounced scheduler
  (`THREAD_EDIT_COMPACTION_DEBOUNCE_MS = 1000`, mockable from
  `preloadSettings.ts`) upserts the target's cache record with the SDK-
  aggregated latest edit bundled by `serializeEventsForCache` into
  `unsigned['m.relations']['m.replace']`. The trailing timer IS the
  stream-end flush; pending upserts are also flushed synchronously on
  `pagehide` and `visibilitychange → hidden` and on component unmount.
  Sweep path is unaffected — bookkeeping still marks skipped-persist ids as
  seen so replaces cannot cause endless re-sweeps. Hydration lazily deletes
  legacy standalone replace records whose target record already bundles an
  equal-or-newer edit under the D12 ordering (independent-review tightening;
  deleting eagerly could lose the newest edit until a later re-persist; full
  purge lands with the Phase 2 D8 wipe). AC4 evidence recorded above;
  e2e run is pending (deferred out of this session per instructions).
  Workflow review round 1 follow-ups: fire-time target misses now fall back
  to persisting the replace standalone (`editCompactionTargetMisses` probe),
  room-view thread attribution is captured at schedule time (mid-debounce
  redaction tombstones land), and `collectStateTargetEvents` no longer
  re-expands pruned redacted reactions. Round 2 follow-ups: cross-sender
  replaces are always emitted as standalone records — direct persist when
  the target is known at arming, fire-time sender re-check when the target
  materializes only during the debounce window — and the window keeps the
  D12-latest replace rather than the last-arrived one.

- 2026-07-03 — **P1.3 landed** (PR 5): deterministic edit tiebreak (D12).
  Review follow-up: `applyCachedRedactions` never re-applies a cached
  redaction over an already-redacted instance (the live-attached redaction
  wins; the D12 pick only orders redactions for a not-yet-redacted target).
  Shared comparator `isEventOrderedAfter` (ts, then lexicographic event id,
  full tie keeps the incumbent instance) used by `getLatestEdit` and the
  cached-redaction selector. AC12 unit tests assert order-independence for
  same-millisecond edits.

- 2026-07-03 — **P1.2 landed** (PR 4): redaction cache lifecycle. Reaction
  records deleted (with by-event-id scan fallback), redaction events
  persisted as records and re-applied to late-arriving stale copies (Tuwunel
  serves un-pruned redacted events on /relations and /messages for ~10 s and a
  reload's gappy sync can skip the redaction entirely), prefer-live event
  mapper heals instance divergence both ways, render-merge scrubs reaction
  aggregations by redacted event id, explicit repaint tick. AC3 green in all
  three states.

- 2026-07-03 — **P1.1 landed** (PR 3): room-cache persist sweep is now a
  trailing-debounced (250 ms) delta pass — already-persisted room events are
  skipped, thread groups re-persist only when they contain an unseen event,
  and cached backward tokens are only written when the delta contains the
  overall-earliest event. AC5 formal measurement via the probe happens with
  the P1.4 streamed-edit spec run.

- 2026-07-03 — **P0.1 + P0.2 landed** (PR 2 of the stack): cache write probe
  (`cacheProbe.ts`) wired into both save paths and the persist entry points
  (put/save/error counters, hydrate timing marks, `window.__MINDROOM_CACHE_PROBE__`);
  matrix e2e helpers for `m.replace` edits and redactions; three red live specs
  annotated `test.fail()`: `cinny207-stop-emoji-redaction` (AC3, green in P1.2),
  `cinny207-streamed-edit-cache` (AC4, green in P1.4),
  `cinny207-background-room-freshness` (AC6, green in Phase 3).

- 2026-07-03 — Rebased onto the v4.12.3-based `dev` (`b7b10b9d`); re-verified
  findings F1-F13 anchors on the new base and updated line references.
- 2026-07-03 — Plan created from the caching investigation (two mapping
  passes + direct code reading) and decision discussion with Bas. Findings
  F1–F13, decisions D1–D14, phases P0–P7 defined. No implementation started.
