# MindRoom Cache Strategy

This document is the short operational runbook for MindRoom room/thread caching
in the Cinny fork after the CINNY-207 cache overhaul. It answers: what is
cached, who owns it, when cached data can drive UI, and which fallback patterns
are forbidden.

The long-form design doc is `docs/mindroom-cache-overhaul-plan.md`.

## Core Model

```text
Matrix live events
  -> MindroomSyncEngine
       WriteThrough  (Tier 1 — every room)
       BackfillScheduler  (Tiers 2 and 3 — background prefetch + current-room deep history)
       CacheStore  (single write path, eviction, quota, schema, compaction)
       Reconciler  (on-open convergence, gap fill)
  -> read APIs / hydration helpers
  -> current-room ThreadRecord index
  -> read-only view models
  -> React components
```

Rules:

- Matrix live events are the source of truth.
- The `MindroomSyncEngine` is created alongside the Matrix client and owns
  every cache write. It is created once per session and torn down on logout.
- UI components and row renderers must not read IndexedDB directly.
- Cache coverage flags describe what a cached snapshot proves. Coverage decides
  what to paint, never whether to revalidate — every open schedules a
  reconcile.

## Cache Layers

| Layer                     | Owner                                                                                                                    | Purpose                                                                                                                                                     | Persistence                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `cacheStore/` (unified)   | `src/app/mindroom/threads/cacheStore/` — one module with schema v3 (`events`, `meta`, `room_ledger`, `thread_summaries`) | Persist main-room timeline events, thread events, per-room byte/activity ledger, thread AI summaries. Single write path, single DB, single eviction budget. | IndexedDB, session-scoped (`mindroom-cache::<sessionId>`). D8 wipes the six legacy DBs on first v3 open. |
| Thread open seed cache    | `src/app/mindroom/threads/threadOpenSeedCache.ts`                                                                        | Fast-open seed for recently opened or room-derived threads.                                                                                                 | In-memory weak map keyed by `Room`.                                                                      |
| Overview cached metadata  | `src/app/mindroom/threads/threadOverviewCacheMetadata.ts`                                                                | Transient cached preview/activity/count/coverage facts used by the current-room index.                                                                      | React state, reset per room.                                                                             |
| Current-room thread index | `src/app/mindroom/threads/useMindroomThreadIndex.ts` plus lower selectors                                                | Build normal and compact `ThreadRecord` maps from live events, cached metadata, tags, summaries, and scheduled status.                                      | Derived in memory.                                                                                       |

## Write Owners

Exactly four engine modules write to the cache:

- **`engine/engineWriteThrough.ts` (Tier 1 WriteThrough)** — attaches
  `RoomEvent.Timeline` and `RoomEvent.Redaction` at client scope, so every
  live event (in any room, encrypted or not, thread or main) reaches the
  cache regardless of whether the room is mounted. Includes the P1.4 edit
  compaction and the P1.2 redaction lifecycle.
- **`engine/backfillScheduler.ts` (Tier 2/3 BackfillScheduler)** — priority
  queue with concurrency cap 2, `AbortController` per job, in-flight dedup
  map keyed by (roomId, threadId, kind). Every backfill-shaped network
  fetch runs through this scheduler.
- **`engine/reconciler.ts` (Reconciler)** — on-open convergence pass; the
  only writer to the cache that repairs missed edits / redactions /
  aggregations.
- **`engine/gapFillExecutor.ts` and `engine/deepHistoryJob.ts`** — executors
  that use `mx.createMessagesRequest` + `saveRoomEventsToCache` (never the
  SDK live timeline). Enqueued through the BackfillScheduler.

All four route through `threads/cacheStore/` for the actual IDB writes.
`threads/eventRepository.ts` is the serialization seam (pure — always
delegates to the injected `save`).

Explicit inverse rule: render components (`MindroomRoomTimeline`,
`mindroom/messages/**`) and per-room controllers own ZERO writes. They
consume read APIs and, where necessary, invoke the engine via
`useMindroomSyncEngine` — never `saveRoomEventsToCache` directly.

## Read Owners

| Consumer                                                        | Allowed cache input                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useMindroomThreadIndex`                                        | Cached overview metadata and summary store output.                                                                                                  |
| `ThreadRecord` builders                                         | `ThreadCacheCoverage` and record-level presentation/status snapshots.                                                                               |
| Compact cards, badges, headers, recent threads, command palette | `ThreadRecord` or a view model derived from `ThreadRecord`.                                                                                         |
| Thread open                                                     | `threadOpenCacheController` + `threadOpenCacheFirst` for the paint, `engine.reconciler.scheduleReconcile(...)` for convergence.                     |
| Room open                                                       | Cache-hydration seed via `roomCacheHydrationController`; `engine.noteRoomFocused` for scope stamping, protection registry, and scheduled reconcile. |
| Room and thread pagination commands                             | Cached pagination snapshots via `eventRepository.ts`.                                                                                               |

Any production UI surface that wants summary text, latest reply preview,
message count, tags, scheduled state, or resolved state should consume a
`ThreadRecord`-derived model.

## Coverage Semantics

`ThreadCacheCoverage` lives in `src/app/mindroom/threads/types.ts` and is
interpreted by `threadCacheCoverage.ts`.

| Field                      | Meaning                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `eventCount`               | Number of cached events represented by the snapshot or record input.                                                  |
| `oldestTs` / `newestTs`    | Timestamp bounds for cached facts when known.                                                                         |
| `backwardToken`            | `string` means an older cached/network page may exist; `null` means the start is known; `undefined` means not proven. |
| `hasMoreBackward`          | Explicit older-page fact. Defaults to true when `backwardToken` is a string.                                          |
| `snapshotComplete`         | The cached thread snapshot appears complete for the expected local event set.                                         |
| `relationSnapshotComplete` | Relation/reply metadata has been fetched or reconstructed for the cached snapshot.                                    |
| `tailLoaded`               | The latest/tail side of the thread has been loaded.                                                                   |
| `expectedReplyCount`       | Best known reply count from root relation metadata, SDK thread state, or cache metadata.                              |

**D7 — coverage decides painting, not revalidation.** Complete coverage means
the reconcile is _expected_ to be a cheap no-op, not that the reconcile is
skipped. Every thread open and every room open schedules a
`'reconcile'` job through the engine's scheduler; the reconciler diffs the
network response against the cached page and only calls `onRepaired` when
a divergence exists.

Derived read-only decisions:

- `isCompleteThreadCacheCoverage(...)` — the paint gate. Requires a local
  snapshot, `snapshotComplete`, `relationSnapshotComplete`, `tailLoaded`, and
  a known backward start.
- `shouldBackfillThreadRelationsFromCoverage(...)` — true when a local
  snapshot exists but snapshot/relation coverage is incomplete; drives a
  band-2 `'thread-backfill'` job in addition to the reconcile.
- `shouldShowThreadLoadOlderFromCoverage(...)` — true when the SDK has a
  backward token or cache coverage proves a backward gap.

Coverage is conservative. Unknown is not the same as complete.

## Merge Rules

- Newer event-derived live data wins over older cached data.
- Cached data may fill missing live data during startup or resume.
- Cached activity, latest-reply preview, sender, and message count should
  only upgrade current index facts when the cached snapshot is newer or
  strictly richer.
- Cached summaries can be shown first, but live/newer summaries should
  replace them through `threadSummaryStore`.
- Cached compact-root body text is an index input used to construct records.
  It is not a per-row render fallback.
- Optimistic/pending tag writes live in `threadTagPending.ts` and are merged
  by tag snapshot selectors; they are not part of the raw event cache.

When two surfaces disagree, fix the selector, cache metadata update, or
`ThreadRecord` builder. Do not add surface-local precedence logic.

## Main Flows

### Cold Room Open

1. `roomCacheHydrationController` paints the room timeline from cached
   events.
   The bounded page can extend both ends of the restored SDK timeline.
   An equal or newer SDK tail does not prove that older cached roots are loaded.
   Older events are prepended together when the page overlaps the oldest loaded event; an unknown gap remains for reconciliation.
   A timeline reset or concurrent pagination invalidates the captured prepend boundary and token.
   If decryption lets the live tail advance, pending cached appends are rechecked against that tail while retaining same-ID revisions and live instances.
2. `useMindroomThreadIndex` derives room surface entries and `ThreadRecord`
   maps from the painted set.
3. `engine.noteRoomFocused(roomId)` stamps the tier ledger, adds the room
   to the eviction-protected registry, and schedules a room-scope
   `'reconcile'` job (band 0). If the room has a durable
   `tailDiscontinuity` marker, `gapFillExecutor` also fires a
   `'gap-fill'` job (band 1).
4. If deep-history is enabled, a band-4 `'room-deep-history'` job persists
   further backward pages via `mx.createMessagesRequest`. Depth is bounded
   by the user's `prefetchDepth` setting (D4).

The cache page is read asynchronously and applied before initial room hydration completes.
The reconcile / gap-fill / deep-history jobs run through the scheduler without blocking cached paint.

### Thread Open

1. `threadOpenSeedController` applies a fast seed (live room events,
   in-memory seed cache, current thread model state).
2. `threadOpenCacheController.hydrateThreadFromCache` paints the thread
   from cached thread pages.
   Supplemental cached messages paint before awaiting pending SDK sync-gap token conversions, which may require network responses.
   SDK timeline work still waits for conversion and checks that the same thread remains open.
3. `engine.reconciler.scheduleReconcile({reason:'open-complete-coverage'|
'open-partial-coverage', roomId, threadId, cachedPage, onRepaired})`
   ALWAYS runs — coverage decides paint, D7 forbids skipping the network
   verify.
4. When coverage is partial, the SDK bootstrap + a `'thread-backfill'`
   scheduler job also fire in parallel.
5. `onRepaired` fires at most once per reconcile pass and only when
   divergence was detected (missed edit / redaction / new id / bundled
   `m.replace` on cached id) — the P5.2 applier hardens against
   array-length growth so scroll stays anchored.

### Compact Overview Resume

1. Current-room records are built from live room events and current
   cached metadata.
2. `threadOverviewCacheHydration` reads cached thread pages for visible or
   relevant roots.
3. Overview resume enqueues a `'thread-backfill'` job on the engine's
   scheduler (P4.4 dedup domain shared with the seed prewarm), so
   duplicate `/relations` fetches for the same (room, thread, kind)
   collapse into one promise.

### Back Pagination

1. Room and thread pagination commands ask `eventRepository.ts` for cached
   pages first.
2. If cache returns events, those are prepended with scroll anchoring
   preserved.
3. If cache metadata proves the start, stale SDK backward tokens are
   cleared.
4. If cache misses or proves a gap, the command falls back to Matrix SDK
   pagination.

### Tiered Prefetch (D2/D4)

The `MindroomSyncEngine` runs three prefetch tiers, all bounded by the
user's `prefetchScope` setting (`my-server` default, `all-rooms`,
`current-room-only`):

- **Tier 1 — WriteThrough (unconditional).** Live events from `/sync`
  land in the cache regardless of which room is mounted. Includes
  redaction lifecycle and edit compaction. No user opt-out — this tier
  is what makes background rooms fresh (AC6).
- **Tier 2 — Background backfill.** Tails + thread inventory to a modest
  depth (`ROOM_TAIL_PREFETCH_DEPTH = 200`,
  `THREAD_INVENTORY_PREFETCH_LIMIT = 50`), prioritized queue, gated by
  the scope setting. My-server rooms by default; federated rooms wait
  for user attention (a band-0 job fires on open).
- **Tier 3 — Deep history.** Current room only, bounded by the user's
  `prefetchDepth` setting (D4, clamped to
  [`ROOM_TAIL_PREFETCH_DEPTH`, `CURRENT_ROOM_DEEP_HISTORY_TARGET`] =
  [200, 10000]). Band 4 on the scheduler; uses
  `mx.createMessagesRequest` + `saveRoomEventsToCache` (never touches
  the SDK live timeline — see Deviations §8).

Scheduler properties: single priority queue, concurrency cap
`MAX_CONCURRENT_BACKFILL_JOBS = 2`, in-flight dedup by (roomId,
threadId, kind), `AbortController` on `engine.stop()`.

## Forbidden Patterns

Do not add:

- Cache writes that bypass `cacheStore/` — the four engine writers are the
  only sanctioned entry points.
- History fetches outside `BackfillScheduler`, `gapFillExecutor`, or the
  `reconciler` (`mx.createMessagesRequest` / `mx.fetchRelations` calls
  from render components trip the P4.3 / P5.1 architecture guards).
- Cross-room prefetch initiated from a room timeline screen. Cross-room
  work exists and is important (Tier 1 + Tier 2), but it lives
  EXCLUSIVELY inside the engine's scheduler and runs under the user's
  scope policy — never as a room-mounted useEffect.
- Reintroducing a preload-limit-style setting. The D4 replacement
  (`prefetchScope` + `prefetchDepth`) is the settings shape;
  `paginationLimit` was retired in P6.1 and its stored value is scrubbed
  on app boot (see `mindroomSettingsBootstrap.ts`).
- `loadLatestCachedThreadEvents(...)` calls from row renderers or React
  components.
- Component-local maps for summary, latest reply, message count, tags,
  scheduled state, or activity when a `ThreadRecord` field can represent
  the fact.
- Fallbacks that do not state which coverage condition makes them safe.
- Independent compact-view, normal-view, recent-thread, and
  command-palette precedence rules.

## Review Checklist

For any cache-related change:

- Which cache layer does it read or write?
- Is the writer one of the four engine owners
  (WriteThrough / BackfillScheduler / Reconciler / CacheStore delete API)?
- Does the UI consume `ThreadRecord` or a record-derived view model?
- What coverage fact proves pagination, completeness, or relation
  freshness?
- Does the change preserve scroll anchoring for prepends?
- Does cached data only fill missing/older data, instead of overriding
  fresher live data?
- Does any new backfill fetch go through the scheduler's dedup domain
  (kind key added if a new job type is introduced)?
- Does the open still schedule a reconcile even when coverage is
  complete (D7)?
- Are focused tests covering cached-only, live-only, and mixed cached/live
  states?

If any answer is unclear, update this document before adding another
fallback path.
