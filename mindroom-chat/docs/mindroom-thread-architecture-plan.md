# MindRoom Thread Architecture Refactor Plan

## Purpose

This plan defines the target architecture for MindRoom-specific room/thread behavior in the
Cinny fork. The goals are:

- Make room and thread behavior fast from cache without treating cache as a second source of truth.
- Remove duplicated derivation of summaries, tags, counts, previews, activity, and status.
- Keep upstream Cinny file diffs small so future rebases are predictable.
- Make each refactor step behavior-preserving and independently testable.

For the cache-specific operational rules, use
[`docs/mindroom-cache-strategy.md`](./mindroom-cache-strategy.md).
That runbook defines cache layers, allowed owners, coverage semantics, merge rules, and review
checks for future cache/preload changes.

## Current Problem

MindRoom thread behavior is currently spread across large upstream-adjacent files and multiple
fork-owned helper modules. The same facts are derived in several places:

| Fact                                       | Current duplication risk                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary text and message count             | Parsed from events, persisted in summary cache, extracted from thread event cache, merged in `RoomTimeline`, compact view, recent threads, and command palette. |
| Root preview and latest reply preview      | Built in presentation helpers, overview metadata, compact cards, recent-thread helpers, and command palette.                                                    |
| Tags and resolved state                    | Aggregated in room-level hooks, single-thread hooks, command palette, and component-local fallbacks.                                                            |
| Streaming, scheduled, unread, and activity | Calculated in hooks, overview metadata, compact cards, and command palette.                                                                                     |
| Cache hydration                            | Room event cache, thread event cache, summary cache, seed cache, and overview hydration each expose partial views of the same room/thread state.                |

The largest risk is that UI components remain smart. A component should not decide how to merge
Matrix state, cached state, and fallback state. It should receive a view model and render it.

## Core Principle

There is one source of truth and several derived layers:

```text
Matrix events
  -> persisted raw event cache
  -> derived thread index
  -> read-only view models
  -> React components
```

Rules:

- Matrix events are the truth.
- IndexedDB raw event cache is a persisted mirror of Matrix events plus coverage metadata.
- Derived indexes are materialized views rebuilt from live and cached events.
- React view models are read-only projections for specific UI surfaces.
- Components do not read IndexedDB directly.
- Components do not independently re-derive summary, tags, counts, previews, or status.

## Living Document Rules

This file is the planning source of truth while the refactor is active. Update it whenever a slice
changes the architecture boundary, proves a phase complete, or intentionally leaves a follow-up.

Working rules:

- Prefer one behavior-preserving commit per architectural boundary.
- Each commit should explain which owner became canonical and which old source of truth was removed.
- Keep MindRoom-specific implementation in `src/app/mindroom/**` unless the change is an upstream
  compatibility fix or a narrow integration seam.
- Keep upstream-adjacent files small. They may mount a MindRoom seam or pass data into one, but they
  should not parse MindRoom protocol state, read MindRoom cache tables, or assemble thread records.
- Do not add defensive fallback paths unless the missing source of truth is explicitly documented,
  covered by a failing regression test, and scheduled for removal.
- If a fallback is needed for cache/live mixed startup, name the cache coverage condition that makes
  it valid. A fallback without coverage metadata is treated as technical debt.
- Prefer behavior/API tests over broad source-string tests. Source-string tests are allowed only for
  narrow import-boundary guardrails.
- Before moving to the next slice, make branch health explicit: targeted tests for the touched owner,
  then `npm run typecheck`, and for larger slices `npm test`, `npm run lint`, `npm run build`, and
  `git diff --check`.
- Update `FORK_CHANGES.md` after implementation commits, not for speculative plan edits.
- Leave history rewrite and squashing until the architecture is stable and validated.

Definition of "single source of truth":

- Raw Matrix events and raw cached events enter through repository/cache owners.
- `useMindroomThreadIndex` and lower fork-owned selectors build the canonical current-room
  `ThreadRecord` map.
- Surface-specific code can derive view models from `ThreadRecord`, but it must not read raw cache,
  scan state events, or invent independent summary/status/count precedence.
- If two surfaces disagree, the fix belongs in the selector/index/view-model layer, not in one
  surface's render code.

## Active Work Queue

This queue is intentionally concrete. Remove or rewrite entries as soon as they are completed.

Completed in the 2026-04-25 cleanup pass:

- Scheduled thread status is centralized in `threadScheduledStatus.ts`.
  `ThreadRecord` consumes `{ scheduledTaskCount, nextScheduledTs }` snapshots instead of raw
  scheduled-task events, and `useMindroomThreadIndex` returns `scheduledStatusMap`.
- Dead legacy overview selectors were removed from `roomThreadOverviewModel`. Filtering, sorting,
  status counts, tag counts, and search are record-derived through `threadRecordOverview`.
- Generic message search no longer imports `MindroomSearchResultBody` directly.
  `MessageSearch` accepts a result-body renderer seam, and
  `src/app/mindroom/message-search/MindroomMessageSearch.tsx` supplies the MindRoom renderer.
- Generic route-back handling no longer imports MindRoom native edge-swipe behavior directly.
  `src/app/components/BackRouteHandler.tsx` owns only route-back calculation, while
  `src/app/mindroom/native/MindroomBackRouteHandler.tsx` mounts the native swipe gesture for
  MindRoom page/header integration points.
- Generic settings integration no longer imports concrete Local MindRoom settings modules or the
  message preload-limit tile directly. `src/app/mindroom/settings/settingsMenuExtensions.ts` owns
  pure menu/initial-page policy, while `src/app/mindroom/settings/settingsExtensions.tsx` owns
  fork-specific settings UI rendering seams.
- Thread tag display/resolved snapshots are centralized in
  `src/app/mindroom/threads/threadTagSnapshots.ts`, so command palette thread items, room-level tag
  resolution, single-thread tag hooks, and tag mutation reads consume the same aggregated state
  projection.
- Time-aware scheduled-thread status is centralized behind
  `src/app/mindroom/threads/useThreadScheduledStatus.ts`; thread headers and thread indicators no
  longer rebuild scheduled-task maps independently.
- Cached overview metadata is centralized behind
  `src/app/mindroom/threads/threadOverviewCacheMetadata.ts`; `useMindroomThreadIndex` now consumes
  one cached metadata snapshot/controller instead of owning independent cached activity,
  latest-preview, sender, message-count, compact-root-preview, and coverage maps.
- Message search implementation, helpers, and tests live under
  `src/app/mindroom/message-search`; the old generic `features/message-search` folder is gone
  because this fork only mounts message search through the MindRoom search wrapper.
- Room timeline implementation lives under `src/app/mindroom/threads/MindroomRoomTimeline.tsx`.
  `src/app/features/room/RoomTimeline.tsx` is now a narrow compatibility re-export, so future
  timeline ownership work happens in the MindRoom namespace instead of the upstream room feature
  folder.
- Room message rendering implementation lives under
  `src/app/mindroom/messages/MindroomMessage.tsx`. The old generic
  `src/app/features/room/message/Message.tsx` path is now only a compatibility re-export, so
  message menu/header extension work stays in the MindRoom message namespace.
- Room composer implementation lives under
  `src/app/mindroom/room-input/MindroomRoomInput.tsx`. The old generic
  `src/app/features/room/RoomInput.tsx` path is now only a compatibility re-export, so command
  autocomplete, thread reply context, voice recording, and auto-thread send-session work stays in
  the MindRoom room-input namespace.
- Room-view implementation lives under `src/app/mindroom/threads/MindroomRoomView.tsx`. The old
  generic `src/app/features/room/RoomView.tsx` path is now only a compatibility re-export, so
  thread state, banner/timeline/composer wiring, and room-level iOS keyboard handling stay in the
  MindRoom thread namespace.
- Room-view header implementation lives under
  `src/app/mindroom/threads/MindroomRoomViewHeader.tsx`. The old generic
  `src/app/features/room/RoomViewHeader.tsx` path is now only a compatibility re-export, so
  thread-aware mark-read, native back handling, and command-palette opener wiring stay in the
  MindRoom namespace.
- Room shell implementation lives under `src/app/mindroom/threads/MindroomRoom.tsx`. The old
  generic `src/app/features/room/Room.tsx` path is now only a compatibility re-export, so
  last-open-thread restore and escape-read-receipt policy stay in the MindRoom thread namespace.
- Pinned-message menu implementation and styles live under
  `src/app/mindroom/messages/MindroomRoomPinMenu.tsx` and
  `src/app/mindroom/messages/MindroomRoomPinMenu.css.ts`. The old generic
  `src/app/features/room/room-pin-menu/RoomPinMenu.tsx` path is now only a compatibility
  re-export, so cache-aware pinned event lookup and approval rendering stay in the MindRoom message
  namespace.
- Normal and compact room overview `ThreadRecord` map construction is centralized in
  `src/app/mindroom/threads/threadIndexRecords.ts`. `useMindroomThreadIndex` still owns the
  current-room index snapshot, but the repeated normal/compact record-building fallback policy is
  now one selector boundary.
- Fetched relation overview updates now go through
  `src/app/mindroom/threads/threadOverviewCacheHydration.ts`. `useMindroomThreadIndex` wires the
  controller and consumes the resulting metadata, but the cache metadata mutation and summary-store
  upgrade policy are owned by the overview-cache module.
- MindRoom-owned room modules now bypass their old `features/room` compatibility re-exports when
  importing moved implementations. Production routing imports the MindRoom room shell directly,
  `MindroomRoomView` imports the MindRoom timeline/composer directly, and `MindroomRoomTimeline`
  imports the MindRoom message implementation directly. The old feature files remain only as
  upstream compatibility seams.

Pass closure status:

1. Upstream-diff ownership audit is complete for this pass.

   - Command:
     `git diff --name-only v4.11.1 -- src | grep -v '^src/app/mindroom/' | wc -l`
     reports 257 non-MindRoom paths.
   - Earlier in the pass this count was 270. The remaining count did not drop after later room
     moves because the old upstream paths are intentionally retained as narrow compatibility seams
     or are generic integration/fix/test files.
   - The largest old room files (`RoomTimeline`, `Message`, `RoomInput`, `RoomViewHeader`, `Room`,
     `RoomView`, and `RoomPinMenu`) are no longer implementation owners; they are tiny re-export
     seams. MindRoom-owned production code imports the moved implementations directly.
   - Remaining non-MindRoom categories are deliberate: compatibility seams, generic auth/session/iOS
     integration, generic settings/page/sidebar mount points, generic rendering/parser hooks, and
     reusable upstream-style fixes/tests.

2. Cache/preload acceptance is complete for this pass.
   - Cache hydrate/persist orchestration sits behind repository/controller seams:
     `eventRepository.ts`, `roomCacheHydrationController.ts`, `roomCacheLifecycleController.ts`,
     `threadCachePersistenceController.ts`, `threadOpenCacheController.ts`,
     `threadOpenCacheFirst.ts`, and `threadOverviewCacheHydration.ts`.
   - Coverage decisions flow through `ThreadCacheCoverage` and `threadCacheCoverage.ts`, and
     pagination/window decisions consume that lower coverage selector rather than render-path cache
     reads.
   - `ThreadRecord.cache` is populated for records with conservative live/cache coverage. The only
     remaining cached map read in `useMindroomThreadIndex` is the compact-root body map used as an
     input to record construction, not a per-row render fallback.
   - `RoomTimeline` no longer imports raw room/thread cache stores or cached summary loaders.

Follow-up queue:

- Do not continue broad architecture refactors without a concrete behavior, performance, or rebase
  win. The next changes should be bug/perf-driven and should keep the same rule: new MindRoom policy
  goes into `src/app/mindroom/**`, generic files stay as narrow seams.
- Source-string architecture tests are still intentionally present as import-boundary guardrails.
  If they become noisy during history rewrite, replace only brittle string checks with behavior/API
  tests that prove the same owner boundary.

## Rebase Constraint

MindRoom-specific logic should live in fork-owned modules. Upstream Cinny files should contain only
narrow integration seams.

Good upstream touchpoint:

```tsx
const threadModels = useMindroomThreadIndex(room, inputs);
```

Good render seam:

```tsx
<MindroomThreadBadge model={model.badge} />
```

Bad upstream touchpoint:

```tsx
const summary = pickLatestThreadSummaryInfo(...);
const cached = await loadLatestCachedThreadSummaryInfo(...);
const tags = aggregateThreadTagEvents(...);
```

MindRoom protocol constants are also fork-owned. Raw `com.mindroom.*` event names should live beside
the feature that parses or writes them, not in shared Matrix enums or generic UI modules.

Target namespace:

```text
src/app/mindroom/threads/
  summaryCodec.ts
  eventRepository.ts
  summaryStore.ts
  tagStore.ts
  statusIndex.ts
  presentation.ts
  threadIndex.ts
  threadViewModels.ts
  preloadController.ts
  types.ts
```

Existing fork modules can be moved or wrapped into this namespace in small steps. Do not perform a
large directory move until behavior is already stabilized.

## Target Ownership

| Owner               | Responsibility                                                                                | Must not do                                       |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `summaryCodec`      | Parse MindRoom summary events and choose latest summary info.                                 | Read cache, subscribe to React state, inspect UI. |
| `eventRepository`   | Read/write raw room and thread events plus coverage metadata in IndexedDB.                    | Build UI view models.                             |
| `summaryStore`      | Store in-memory summary state and persist summary index records if needed for fast startup.   | Re-parse unrelated thread metadata.               |
| `tagStore`          | Aggregate tag and resolved state, including pending optimistic tag writes.                    | Render tag UI.                                    |
| `statusIndex`       | Derive streaming, scheduled, unread, activity, participants, and reply count.                 | Read component props or local UI state.           |
| `presentation`      | Derive summary text, root preview, latest reply preview, title text, and fallback labels.     | Read IndexedDB directly.                          |
| `threadIndex`       | Build one canonical per-room map of `ThreadRecord` keyed by `threadRootId`.                   | Render React components.                          |
| `threadViewModels`  | Convert `ThreadRecord` into compact card, badge, header, sidebar, and command-palette models. | Fetch Matrix relations or mutate cache.           |
| `preloadController` | Decide what to warm, fetch, persist, and index for the current room.                          | Render UI or set component-local fallback maps.   |

## Target Types

The exact shape can evolve, but the architecture should converge on these concepts.

```ts
type ThreadId = {
  roomId: string;
  threadRootId: string;
};

type ThreadPresentationSnapshot = {
  summaryText?: string;
  summaryGeneratedTs?: number;
  messageCount: number;
  rootPreviewText?: string;
  latestReplyPreviewText?: string;
  titleText: string;
  subtitleText?: string;
  lastSenderId?: string;
  lastSenderDisplayName?: string;
  participantIds: string[];
};

type ThreadStatusSnapshot = {
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledTaskCount: number;
  nextScheduledTs?: number;
  lastActivityTs: number;
  tags: string[];
};

type ThreadCacheCoverage = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  relationSnapshotComplete: boolean;
  tailLoaded: boolean;
  expectedReplyCount?: number;
};

type ThreadRecord = ThreadId & {
  rootEventId?: string;
  presentation: ThreadPresentationSnapshot;
  status: ThreadStatusSnapshot;
  cache: ThreadCacheCoverage;
  absoluteIndex: number;
};
```

UI-specific view models should be derived from `ThreadRecord`:

```ts
type CompactThreadCardViewModel = {
  id: ThreadId;
  title: string;
  preview: string;
  replyCountLabel: string;
  statusLabel: string;
  tags: string[];
  participants: Array<{ userId: string; displayName: string; avatarUrl?: string }>;
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledLabel?: string;
  lastActivityLabel?: string;
};
```

## Cache Model

Caching is required for fast startup, fast room re-entry, and fast thread opens. Cache should be
designed as persisted data plus coverage, not as component fallback state.

```ts
type CachedRoomSnapshot = {
  roomId: string;
  events: RawMatrixEvent[];
  coverage: {
    eventLimit: number;
    oldestKnownTs?: number;
    newestKnownTs?: number;
    backwardToken?: string | null;
    completeBackward: boolean;
  };
};

type CachedThreadSnapshot = {
  roomId: string;
  threadRootId: string;
  rootEvent?: RawMatrixEvent;
  events: RawMatrixEvent[];
  coverage: ThreadCacheCoverage;
};

type CachedThreadIndexRecord = ThreadRecord & {
  updatedAt: number;
  derivedFromEventIds: string[];
};
```

Cache rules:

- Raw cached events and live Matrix events feed the same indexer.
- Cached index records can be used for instant paint.
- Cached index records are replaceable materialized views, not truth.
- Summary cache should be merged into the thread index or treated as an index table, not queried ad hoc from UI code.
- A newer live event-derived value wins over older cached data.
- A cached value can fill missing live data until live data catches up.
- Coverage metadata must explain why "load more" is shown or hidden.

## Preload Model

Preloading should be owned by a room-scoped background controller.

```ts
type RoomPreloadPolicy = {
  roomId: string;
  eventLimit: number;
  includeThreadRelations: boolean;
  includeMediaMetadata: boolean;
  concurrency: number;
};
```

Expected behavior:

- Hydrate the current room from cached index records immediately.
- Load room timeline backwards until `eventLimit` or no more history.
- Discover all candidate thread roots from live and cached current-room events.
- Preload thread relations for current-room thread roots, including non-visible threads, within the policy budget.
- Persist raw events and update the derived thread index in batches.
- Notify React subscribers once per batch, not once per event or per card.
- Never preload unrelated rooms from the room timeline screen.

If `eventLimit` is raised from 10k to 100k, the controller should attempt to cache substantially
more of the current room history and associated thread relations, bounded by server pagination,
runtime cancellation, and browser storage limits.

## UI Surface Contract

Every surface should render from the same thread index and view-model layer:

| Surface                  | Input                                             |
| ------------------------ | ------------------------------------------------- |
| Compact room view        | `CompactThreadCardViewModel[]`                    |
| Normal room thread badge | `ThreadBadgeViewModel`                            |
| Thread context banner    | `ThreadHeaderViewModel` plus tag mutation actions |
| Recent threads sidebar   | `RecentThreadViewModel[]`                         |
| Command palette          | `CommandPaletteThreadViewModel[]`                 |
| Thread route open        | `ThreadRecord` plus cached/live event page        |

Forbidden patterns:

- `CompactThreadCard` calling Matrix hooks for status, tags, scheduled tasks, or activity.
- Recent-thread entries inventing independent fallback summary rules.
- Command palette scanning thread tags and activity with its own custom model.
- `RoomTimeline` directly reading summary cache or loading cached summary info for visible rows.
- Multiple independent maps for summary text, root preview, latest reply preview, message count, and activity where one `ThreadRecord` would suffice.

## Current Adoption Snapshot

This section should be updated after each refactor slice. It is intentionally concrete so we can
tell whether the new architecture is actually being used everywhere.

| Area                          | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Next action                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact room cards            | Converted at the render seam. `CompactRoomView` receives the per-room `ThreadRecord` map, and `useCompactThreadCardViewModels` only adapts records into card models.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Keep card rendering passive; do not reintroduce state/cache lookups here.                                                                                             |
| Normal room thread badge      | Converted at the render seam. `RoomTimeline` consumes the per-room `ThreadRecord` map from `useMindroomThreadIndex`, badge view models are record-only, and badge JSX lives in a fork-owned renderer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Keep badge rendering passive; do not reintroduce direct reply/summary/status derivation here.                                                                         |
| Filtering, sorting, counts    | Converted at the room index and room-view state seams. `useMindroomThreadIndex` assembles normal/compact root data, room-surface entries, timeline-derived reply/participant/summary maps, scheduled status, normal/compact `ThreadRecord` maps, overview ordering, focused-route bypass, effective filters, status counts, tag counts, room-thread list state, and overview cache hydration. Legacy `ThreadOverviewMetadata` map builders and metadata-map filter/sort/count selectors are gone; record-derived overview selectors live in `threadRecordOverview`. Room overview focus/filter helpers now live in `src/app/mindroom/threads/threadRoomFocus.ts`; `RoomTimeline` consumes the snapshot and helper outputs. Room-level thread filter/view-mode/sort-freeze state now lives behind `useRoomViewThreadState`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Keep new overview/index derivation in `useMindroomThreadIndex` or lower fork-owned selectors.                                                                         |
| Thread context banner         | Converted at the header seam. The banner builds a `ThreadRecord` and renders summary, tags, resolved state, and scheduled state through `ThreadHeaderViewModel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Keep mutation permissions/actions outside the record; do not reintroduce local summary logic.                                                                         |
| Recent threads sidebar        | Converted at the entry seam. `RecentThreadEntry` renders a MindRoom-owned `RecentThreadViewModel` built from `ThreadRecord`; the old `useRecentThreadSummary` path is gone. Client startup registers recent-thread and last-open-thread UI storage through `src/app/mindroom/cache/clientStorageAtoms.ts` instead of direct generic-page wiring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Replace the remaining stored-entry plumbing with a room index subscription when available.                                                                            |
| Command palette               | Converted at the MindRoom palette seam. `src/app/mindroom/command-palette` owns the palette UI, open-state atom, item assembly, search helpers, and hotkey handling. Thread sourcing delegates to `src/app/mindroom/threads/commandPaletteThreadItems.ts`; that owner builds recent-thread and SDK-thread `ThreadRecord` objects, reads thread tags, handles current-thread resolved mutations, merges duplicate thread items, and renders a MindRoom-owned `CommandPaletteThreadViewModel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Keep remaining action/user/room/message logic separate inside the palette owner; do not reintroduce thread-specific derivation into generic room/router/sidebar code. |
| Message content rendering     | Converted at the message-render seam. Generic `RenderMessageContent` delegates textual MindRoom policy to `src/app/mindroom/messages/renderMindroomMessageContent.tsx`, which owns summary cards, tool approvals, long-text rendering, AI-run streaming markers, and tool-trace parser options. Timeline-specific approval-event content and badge-model wiring now route through `src/app/mindroom/threads/roomTimelineMessageExtensions.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Keep generic attachment/media rendering in the generic component; do not reintroduce raw MindRoom message metadata decisions there.                                   |
| Message search                | Converted at the result-body seam. Generic `features/message-search` owns search inputs, filters, grouping, pagination, and virtualization, while `src/app/mindroom/message-search/MindroomMessageSearch.tsx` supplies the MindRoom result-body renderer from `searchResultBodyRenderer.tsx`, which mounts `MindroomSearchResultBody`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Keep generic search code unaware of MindRoom body components; if more result behavior becomes fork-only, move it behind the same seam or into the MindRoom namespace. |
| Summary ownership             | Mostly converted. Room view owns shared summary state through `src/app/mindroom/threads/threadSummaryStore.ts`, `useMindroomThreadIndex` owns the timeline-derived summary fallback map for room records, and `RoomTimeline` no longer performs per-visible `loadLatestCachedThreadSummaryInfo` render-path reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keep production summary consumers on `threadSummaryStore`; only legacy compatibility paths should import the lower cache/state modules.                               |
| Tag/resolution ownership      | Mostly converted. Wire parsing/building lives in `threadTags.ts`, pending optimistic state lives in `threadTagPending.ts`, and shared display/resolved snapshots live in `threadTagSnapshots.ts`. Room-level maps, single-thread hooks, mutation reads, and command palette thread items consume the shared snapshot projection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Keep new tag consumers on `threadTagSnapshots` or `useRoomThreadTags`; avoid one-off state-event aggregation in UI adapters.                                          |
| Scheduled status ownership    | Mostly converted. Wire parsing lives in `scheduledTaskContract.ts`, count/next-time derivation lives in `threadScheduledStatus.ts`, and time-aware React consumption lives in `useThreadScheduledStatus.ts`. Thread headers, thread indicators, and `ThreadRecord` consumers use those selectors/hooks instead of scanning scheduled tasks locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Keep scheduled display/count consumers on `threadScheduledStatus` or `useThreadScheduledStatus`; avoid per-surface scheduled-task scans.                              |
| Room/thread cache and preload | Mostly converted at the repository/controller/index seam. Timeline renderability, room-surface entry derivation, room overview display-window derivation, preload target selection, unread anchor derivation, preload counts, eager current-room preload, overview cache hydration and its cached activity/preview/message-count maps, raw cache access, cached room/thread pagination reads, cached thread page stitching/mapping, cache-order/hydration helper derivation, thread cache coverage helpers/decisions, cache payload serialization, room cache persistence/back-state refresh, initial room cache hydration, thread cache persistence/queueing, thread-open seed cache ownership, thread bootstrap/seed-prewarm/relation-fetch helpers, room-visible seed-prewarm queue orchestration, room cache-first back-pagination command, thread-open lifecycle/cache/network commands, live event cache/summary/auto-follow policy, overview resume target selection/refresh orchestration, compact root edit backfill, thread-message edit backfill, and room-derived thread-cache persistence now live outside `RoomTimeline`. Resume-fetched relation pages now update the per-room `ThreadRecord` index directly before the async cache write/read path catches up. `ThreadRecord.cache` is now populated for every record with conservative live/cache coverage. | Keep cache/preload orchestration behind repository/controller/index seams; do not reintroduce render-path cache reads.                                                |
| Scroll and pagination         | Mostly converted. Thread prepend anchor capture/restore lives in scroll utilities, thread back-pagination mutable state lives in `useThreadBackPaginationController`, thread back/front pagination commands live in `useThreadPaginationCommandController`, route debug trace/range instrumentation lives in `useTimelineDebugTraceIds` / `useTimelineDebugRangeController`, bottom-anchor/read-receipt ownership lives in `useTimelineReadReceiptController`, event deep-link/open routing lives in `useRoomEventOpenController` / `useRoomEventRouteOpenController`, route focus/pending-open/edit/bottom-pin scroll effects live in `useRoomFocusScrollController`, and jump-to-latest/unread plus thread-card open navigation live in `useRoomTimelineNavigationController`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Keep remaining generic message actions local unless a clearer fork-owned seam appears.                                                                                |
| Reaction rendering            | Not part of the thread model refactor. Fresh normal-message and thread-reply reactions pass e2e.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | If regressions remain, debug as cache/relation coverage or room-specific data, not UI model.                                                                          |

The main architecture pass has crossed the per-room index boundary: `RoomTimeline` now consumes
`useMindroomThreadIndex` instead of assembling normal/compact `ThreadRecord` maps, overview
ordering, focused-route bypass, effective filters, status counts, tag counts, and overview cache
fallback maps directly. The hook also owns room-surface entry derivation, visible/compact root data,
timeline-derived reply/participant/summary maps, scheduled-status derivation, available room tags,
read-up-to timestamp derivation, and current-room SDK thread-list loading. Compact cards, normal room badges, overview filter/sort/count logic, the
room-overview focus/filter helpers, thread banner, recent thread entries, command palette thread items, and overview cache hydration
share the `ThreadRecord` seam. Command-palette UI and state now live in
`src/app/mindroom/command-palette`, and thread sourcing lives in
`src/app/mindroom/threads/commandPaletteThreadItems.ts`, so generic router/sidebar/header code no longer owns
the fork-only palette and the palette no longer reads raw thread tag state, recent-thread atoms, or thread-record builders directly. `RoomTimeline` no longer
does per-visible cached-summary reads, no
longer builds `ThreadOverviewMetadata` maps as an intermediate source for records, no longer owns
`getThreadFilteredEvents`, `getRoomEventFocusTarget`, or ordered room-overview event resolution, and
no longer imports raw room/thread cache
stores, cached room/thread pagination readers, cached event normalizers, thread-open seed cache from
`features/room`, or back-pagination anchor refs. `threadRecord` no longer accepts legacy metadata
objects or maps. Normal badge rendering is behind a fork-owned view-model seam, and
renderability/preload counting, eager current-room preload, overview cache hydration, raw event cache
access, cached room/thread pagination, cached thread page stitching/mapping,
cache-order/hydration helper derivation, thread cache coverage helpers, cache payload serialization,
room cache persistence state, room-derived thread-cache persistence, and thread back-pagination
state have been moved out of `RoomTimeline`. Thread bootstrap, room-loaded seed extraction, seed
prewarm prioritization, relation-page fetching, compact root backfill detection, thread-not-found
classification, and overview refresh targeting now live in `src/app/mindroom/threads/threadBootstrap.ts`.
Timeline-specific MindRoom approval content and badge-model derivation now route through
`src/app/mindroom/threads/roomTimelineMessageExtensions.tsx`, so `RoomTimeline` no longer imports
the low-level approval message owner or badge-record builder directly.
Room-timeline MindRoom approval event-type dispatch also lives behind that seam; `RoomTimeline`
should not import raw MindRoom approval event constants directly.
Shared thread-summary cache/state APIs now route through
`src/app/mindroom/threads/threadSummaryStore.ts`, leaving the lower cache and state modules as
implementation details plus legacy compatibility paths.
Overview resume refresh target selection and refresh orchestration now live in
`src/app/mindroom/threads/threadOverviewResumeController.ts`.
Room overview display-window derivation, unread-anchor calculation, preload target selection, visible
seed-prewarm prioritization, and thread load-older coverage decisions now live in
`src/app/mindroom/threads/roomTimelineWindowController.ts`; `RoomTimeline` consumes that snapshot
instead of assembling those derived maps and ranges inline.
Bottom-anchor intersection handling, document-focus read receipts, thread-at-bottom read receipts,
and explicit mark-as-read routing now live in
`src/app/mindroom/threads/timelineReadReceiptController.ts`; `RoomTimeline` consumes the returned
mark-as-read handler and keeps only the visual jump controls. Thread-aware read-receipt target
selection now lives in `src/app/mindroom/notifications/readReceipts.ts`; the old
`src/app/utils/notifications.ts` path is compatibility-only.
Room-event deep-link redirect, focused-event timeline loading, pending thread-open focus handoff,
and route event-id dedupe now live in `src/app/mindroom/threads/roomEventOpenController.ts`;
`RoomTimeline` consumes the open-event handler and route hook instead of sequencing those branches
inline.
Route focus scrolling, unread anchor scrolling, pending thread-open scroll retries, edit-message
scrolling, thread-open bottom pinning, back-pagination anchor restore, and live-end bottom recovery
now live in `src/app/mindroom/threads/roomFocusScrollController.ts`.
Jump-to-latest, jump-to-unread, thread badge opens, compact-card opens, and recent-thread bumping now
live in `src/app/mindroom/threads/roomTimelineNavigationController.ts`. Startup restore target
selection for last-open-thread state now lives in
`src/app/mindroom/routing/clientRouteRestore.ts`, so generic client layout code no longer reads
last-open-thread storage directly. Room-route last-open-thread persistence, auto-restore, and
failed-thread cleanup live in `src/app/mindroom/threads/useRoomThreadRouteRestore.ts`, so generic
room routing no longer mutates last-open-thread or recent-thread storage directly.
The room-visible seed-prewarm queue, generation guard, and in-flight promise tracking now live in
`src/app/mindroom/threads/threadSeedPrewarmController.ts`.
The cached thread snapshot read used to prewarm thread-open seeds also lives in that controller now,
so `RoomTimeline` no longer directly imports the cached thread snapshot reader for seed prewarm.
Thread-open seed scanning, room/model/cache seed merging, initial seed application, and the
prewarm wait timeout now live in `src/app/mindroom/threads/threadOpenSeedController.ts`.
Thread-open SDK bootstrap, zero-reply/pending-root early completion, relation fallback hydration,
and SDK backward-token reconciliation now live in
`src/app/mindroom/threads/threadOpenSdkBootstrap.ts`.
Thread-open post-bootstrap refresh, including untargeted latest-slice refresh and targeted
permalink/search relation refresh, now lives in
`src/app/mindroom/threads/threadOpenPostBootstrapRefresh.ts`.
Thread-open cache-first flow, including cache hydrate fallback, complete-cache short-circuit,
relation-backfill dispatch, and initial untargeted seed fallback, now lives in
`src/app/mindroom/threads/threadOpenCacheFirst.ts`.
Thread-open targeted event-context loading and pending scroll queue setup now live in
`src/app/mindroom/threads/threadOpenTargetEvent.ts`.
Thread-open route lifecycle orchestration now lives in
`src/app/mindroom/threads/threadOpenLifecycleController.ts`; `RoomTimeline` supplies state refs and
setters but no longer sequences cache-first open, SDK bootstrap, post-bootstrap refresh, targeted
event loading, seed-session cleanup, or thread/room reset state inline.
Thread-aware timeline refresh coalescing now lives in
`src/app/mindroom/threads/useThreadAwareTimelineRefresh.ts`.
Compact thread root derivation, preview fallback selection, zero-reply root detection, and cached
compact-root activity/preview extraction now live in
`src/app/mindroom/threads/compactThreadRootData.ts`; the old `features/room` path is only a
compatibility re-export.
Thread presentation derivation, including summary/root-preview/latest-reply/last-sender/message-count
snapshot assembly, now lives in `src/app/mindroom/threads/threadPresentation.ts`; the old
`features/room` path is only a compatibility re-export.
Thread filter query parsing/serialization now lives in
`src/app/mindroom/threads/threadFilterDsl.ts`; the old `features/room` path is only a
compatibility re-export.
Compact room view/card rendering now lives in `src/app/mindroom/threads/CompactRoomView.tsx`,
`src/app/mindroom/threads/CompactThreadCard.tsx`, and
`src/app/mindroom/threads/CompactRoomView.css.ts`; the old `features/room` paths are only
compatibility re-exports.
Room thread overview controls now live in `src/app/mindroom/threads/RoomThreadOverview.tsx` and
`src/app/mindroom/threads/RoomThreadOverview.css.ts`; the old `features/room` paths are only
compatibility re-exports.
Room thread overview filtering/sorting/count model now lives in
`src/app/mindroom/threads/roomThreadOverviewModel.ts`; the old `features/room` path is only a
compatibility re-export.
Thread sort-freeze resnapshot policy now lives in
`src/app/mindroom/threads/threadSortFreezeController.ts`.
Thread relation/route utility helpers now live in `src/app/mindroom/threads/threadUtils.ts` and
`src/app/mindroom/threads/threadRouteUtils.ts`; the old `features/room` paths are only
compatibility re-exports.
Thread render-mode, local-echo dedupe, replacement preference, and thread-only activity helpers now
live in `src/app/mindroom/threads/threadRenderUtils.ts`; the old `features/room` path is only a
compatibility re-export.
Thread render state merging for live SDK events plus cached/supplemental fallback events now lives
in `src/app/mindroom/threads/useThreadRenderState.ts`; the old `features/room` path is only a
compatibility re-export.
Room timeline event renderability, surface entry, visible thread-root, and preload-count helpers now
live in `src/app/mindroom/threads/roomTimelineEvents.ts`; the old `features/room` path is only a
compatibility re-export.
Timeline linking/count/recalibration, initial/active range selection, unread lookup, focused-event
index lookup, event timeline lookup, and absolute-index helpers now live in
`src/app/mindroom/threads/timelinePagination.ts`; the old `features/room` path is only a
compatibility re-export.
Thread backward-pagination reconciliation helpers now live in
`src/app/mindroom/threads/threadPaginationUtils.ts`; the old `features/room` path is only a
compatibility re-export.
Timeline debug trace helpers now live in `src/app/mindroom/threads/timelineDebug.ts`; the old
`features/room` path is only a compatibility re-export.
Timeline debug trace id lifecycle plus room/thread range logging effects now live in
`src/app/mindroom/threads/timelineDebugController.ts`; `RoomTimeline` only consumes the trace ids
and keeps explicit debug calls tied to local cache/open command bodies.
Timeline live-end, near-bottom, event-element lookup, timeline target-anchor selection, unread
divider placement, room-focus retry/scroll options, focus observer setup, bottom-anchor visibility
recovery, and thread prepend scroll-anchor helpers now live in
`src/app/mindroom/threads/timelineScrollUtils.ts`; the old `features/room` path is only a
compatibility re-export.
Event cache pagination token helpers now live in
`src/app/mindroom/threads/eventCacheTokenUtils.ts`; the old `features/room` path is only a
compatibility re-export.
Event cache hydration, relation aggregation, redaction/replacement application, and serialization
helpers now live in `src/app/mindroom/threads/eventCacheEditUtils.ts`; the old `features/room` path
is only a compatibility re-export.
Current-room surface preload target selection now lives in
`src/app/mindroom/threads/roomPreloadTarget.ts`; the old `features/room` path is only a
compatibility re-export.
Raw room/thread IndexedDB event cache stores and their legacy migration helper now live in
`src/app/mindroom/threads/roomEventCache.ts`, `threadEventCache.ts`, and
`cacheDbMigrationUtils.ts`; the old `features/room` paths are only compatibility re-exports.
Thread tag parsing, optimistic pending state, and read/write hooks now live in
`src/app/mindroom/threads/threadTags.ts`, `threadTagPending.ts`, `useThreadTags.ts`,
`useRoomThreadTags.ts`, and `useMutateThreadTags.ts`; the old `features/room` paths are only
compatibility re-exports.
MindRoom thread-tag and scheduled-task state event names are owned by `threadTags.ts` and
`scheduledTaskContract.ts`; the shared Matrix `StateEvent` enum no longer contains
`com.mindroom.*` state-event names.
Thread banner/tag UI now lives in `src/app/mindroom/threads/ThreadContextBanner.tsx`,
`ThreadTagPicker.tsx`, `ThreadTagPill.tsx`, `ThreadContextBanner.css.ts`, and
`threadTagColor.ts`; the old `features/room` paths are only compatibility re-exports.
Thread scheduled-time display formatting now lives in
`src/app/mindroom/threads/compactThreadCardUtils.ts`; the old `features/room` path is only a
compatibility re-export.
Room-scoped thread filter state and compact/normal view-mode persistence now live in
`src/app/mindroom/threads/roomThreadFilterState.ts` and
`src/app/mindroom/threads/roomViewMode.ts`; the old `state/room` paths are only compatibility
re-exports.
Server-side room thread-list loading, thread unread/activity helpers, and the `useRoomThreadList`
hook now live in `src/app/mindroom/threads/roomThreadList.ts` and `useRoomThreadList.ts`; the old
`features/room` paths are only compatibility re-exports.
Thread-aware compose relation helpers, automatic room-input send-session policy, and the composer
send-session controller now live in `src/app/mindroom/threads/composeMessageRelation.ts`,
`roomInputSendSession.ts`, and `useRoomInputSendSessionController.ts`; the old `features/room`
paths are only compatibility re-exports.
MindRoom slash-bang command definitions, query parsing, and autocomplete UI now live in
`src/app/mindroom/commands/`, with the room-input command/voice mounting seam in
`src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx`; the old `features/room` paths are
only compatibility re-exports.
Room-input thread indicator mounting also lives behind
`src/app/mindroom/room-input/RoomInputMindroomExtensions.tsx`, so the generic composer does not
inspect MindRoom thread relation state directly.
MindRoom bridge detection helpers now live in `src/app/mindroom/bridges/`; the old `features/room`
path is only a compatibility re-export.
MindRoom voice recorder UI and MIME policy now live in `src/app/mindroom/voice/`; the old
`features/room` paths are only compatibility re-exports.
Thread summary cache/state/selection now lives in `src/app/mindroom/threads/threadSummaryCache.ts`,
`threadSummaryState.ts`, `threadSummarySelection.ts`, `threadSummaryPublishController.ts`, and
`useRoomThreadSummaryState.ts`; the old `features/room` paths are only compatibility re-exports.
Thread root route canonicalization now lives in
`src/app/mindroom/threads/useThreadRootEvent.ts`; the old `features/room` path is only a
compatibility re-export.
Thread exit route-state persistence now lives in
`src/app/mindroom/threads/roomNavigateState.ts`; the old `hooks` path is only a compatibility
re-export.
Room-event-to-thread deep-link resolution now lives in
`src/app/mindroom/threads/roomDeepLink.ts`; the old `features/room` path is only a compatibility
re-export.
Thread-open cache hydration, latest-slice refresh, relation backfill, and cached relation-tail
refresh now live in `src/app/mindroom/threads/threadOpenCacheController.ts`; `RoomTimeline` decides
when to open a thread route but no longer owns their cache/network policy.
Overview resume refresh throttling, compact/expanded thread-list refresh, relation-cache refresh,
summary write-through, and `usePageResume` hookup now live in
`src/app/mindroom/threads/threadOverviewResumeController.ts`.
Overview metadata refresh counter subscriptions now live in
`src/app/mindroom/threads/threadOverviewRefreshCounter.ts`.
Viewport-aware overview refresh target selection now lives in
`src/app/mindroom/threads/threadOverviewRefreshTargets.ts`; `RoomTimeline` supplies only the active
range and current overview ids.
Thread-cache persistence and the microtask queue for room-derived thread-cache writes now live in
`src/app/mindroom/threads/threadCachePersistenceController.ts`; `RoomTimeline` still owns only the
plain room-event cache write seam.
Room cache persistence, current-room cache write-through, and cached-back-state refresh now live in
`src/app/mindroom/threads/roomCacheLifecycleController.ts`; `RoomTimeline` consumes only the
returned `persistRoomEventCache` command.
Initial room cache hydration now lives in
`src/app/mindroom/threads/roomCacheHydrationController.ts`; `RoomTimeline` supplies only the
`buildInitialTimeline` callback that chooses the UI range after cached events are inserted.
Compact root edit backfill now lives in
`src/app/mindroom/threads/compactRootEditBackfillController.ts`, including its attempted-event
WeakMap and relation fetch worker.
Thread-message edit backfill now lives in
`src/app/mindroom/threads/threadEditBackfillController.ts`; the backfill policy lives in
`src/app/mindroom/threads/threadEditBackfill.ts`, with the old `features/room` utility path kept as
a compatibility re-export for existing tests/importers.
Live collapsible-message policy for MindRoom summary messages and first-paint live thread replies
now lives in `src/app/mindroom/threads/threadCollapsibleMessages.ts`.
Thread cache coverage now includes backward-gap, snapshot-complete, relation-complete, and tail-loaded
facts, and `RoomTimeline` consumes fork-owned coverage decisions for "Load Older Messages",
complete cached opens, and relation backfill. Route-specific scroll execution against rendered DOM
nodes now lives behind `useRoomFocusScrollController`; `RoomTimeline` still owns the user-facing
jump/reply button rendering and generic message actions, while the route/paginator navigation
handlers live behind `useRoomTimelineNavigationController`.
Thread back/front pagination commands now live in
`src/app/mindroom/threads/threadPaginationCommandController.ts`; `RoomTimeline` only wires the
returned handlers into the load-older/load-newer buttons.
Virtual timeline pagination and permalink event-timeline loading now live in
`src/app/mindroom/threads/timelinePaginationController.ts`; `RoomTimeline` only wires the returned
commands into the paginator and route-focus flows.
Timeline debug trace ids and range instrumentation now live in
`src/app/mindroom/threads/timelineDebugController.ts`; local `RoomTimeline` debug calls are limited
to command-specific milestones that still sit beside the command coordinator.
Live room timeline/redaction event subscription now lives in
`src/app/mindroom/threads/roomLiveEventArrive.ts`; `RoomTimeline` keeps the room/thread policy
callback.
Live room event cache writes, thread supplemental updates, summary-event state write-through,
collapsible live-expand tracking, and auto-follow range updates now live in
`src/app/mindroom/threads/roomLiveEventController.ts`; `RoomTimeline` supplies state refs/setters
but no longer owns the event-arrival policy body.
Room cache-first back-pagination now lives in
`src/app/mindroom/threads/roomPaginationCommandController.ts`; `RoomTimeline` wires the returned
handler into the virtual paginator and no longer imports cached room pagination readers directly.

## Refactor Phases

### Phase 0: Guardrails

- Add this plan and keep it linked from `FORK_CHANGES.md`.
- Treat new product logic in `RoomTimeline.tsx` as a regression unless it is a narrow seam.
- Prefer adding fork-owned modules over expanding upstream Cinny files.
- Keep each step behavior-preserving unless explicitly marked as behavior-changing.

Acceptance:

- Docs-only validation passes with `git diff --check`.

### Phase 1: Define Canonical Types And Selectors

- Add `ThreadRecord`, `ThreadPresentationSnapshot`, `ThreadStatusSnapshot`, and view-model types.
- Wrap existing summary, tag, status, and presentation helpers behind a single selector API.
- Do not move storage or UI yet.

Acceptance:

- Existing tests pass.
- New unit tests prove the same input yields one canonical record for:
  - a normal thread with replies,
  - a zero-reply thread root,
  - a summary event,
  - a resolved/tagged thread,
  - a cached-only thread.

### Phase 2: Make Compact Cards Pure

- Build `CompactThreadCardViewModel` from the canonical selector.
- Remove Matrix/cache/status hooks from `CompactThreadCard`.
- Keep rendering identical.

Acceptance:

- Compact-card tests assert only props/view models are needed.
- Compact view no longer recomputes tags, streaming, scheduled count, unread, or activity per card.

### Phase 3: Unify Summary Ownership

- Make one summary owner responsible for parsing, latest selection, in-memory state, and persistence.
- Remove direct `loadLatestCachedThreadSummaryInfo` usage from render paths.
- Route summary events from live sync and cached thread events through the same owner.

Acceptance:

- Compact view, normal room badges, thread banner, recent threads, and command palette agree on summary text and message count.
- Tests cover cached summary vs newer live summary precedence.

### Phase 4: Build The Room Thread Index

- Introduce a per-room thread index that combines:
  - live Matrix room events,
  - cached room events,
  - cached thread snapshots,
  - summary store,
  - tag store,
  - status index.
- Replace scattered per-component maps with `ThreadRecord`.

Acceptance:

- Thread filtering, sorting, status counts, tag counts, search, compact view, and normal badges consume `ThreadRecord`.
- No separate component-local maps remain for cached activity, latest preview, last sender, message count, and summary.

### Phase 4b: Introduce `useMindroomThreadIndex`

- Add a fork-owned room index hook that receives the current room, view mode, filters, live root
  renderable entries, linked timelines, and summary/tag/status source maps.
- The hook returns a snapshot containing:
  - room-surface entries,
  - visible and compact root data,
  - normal and compact `ThreadRecord` maps,
  - active `ThreadRecord` map,
  - timeline-derived reply/participant/summary maps,
  - scheduled status,
  - available tags,
  - room-thread list state,
  - normal/compact root ids,
  - overview ordered ids,
  - focused-route bypass state,
  - effective filter state,
  - status and tag counts.
- `RoomTimeline` consumes the snapshot instead of assembling this state directly.
- Cache fallback maps and overview hydration state are owned inside the hook, not treated as
  parallel UI sources.

Acceptance:

- `RoomTimeline` no longer owns `normalThreadRecordMap`, `compactThreadRecordMap`, overview ordering,
  status counts, or tag counts assembly.
- `RoomTimeline` no longer owns timeline-derived summary/reply/participant maps,
  scheduled-status maps, compact root data, or current-room thread-list loading.
- `RoomTimeline` no longer owns room overview focus/filter helpers that build ad-hoc
  `ThreadRecord` maps for focus recovery.
- Focused route, compact view, and normal overview behavior are covered by behavior/API tests for the
  index snapshot.
- Source-string architecture tests are kept to narrow import-boundary checks only; behavior contracts
  should live in unit/e2e tests.

### Phase 5: Move Cache And Preload Orchestration Out Of `RoomTimeline`

- Move room event cache, thread event cache, index cache, and preload policy behind `eventRepository` and `preloadController`.
- `RoomTimeline` should only:
  - subscribe to current room/thread models,
  - dispatch preload/open/pagination commands,
  - render.

Acceptance:

- `RoomTimeline` no longer directly imports cache repository internals.
- Current-room preload reaches the configured limit where server history allows.
- Non-visible current-room threads are included in preload policy.
- Thread opens use cached snapshots immediately when available.
- Room-loaded thread seed extraction, seed prewarm target selection, relation-page fetching, and
  compact root backfill target selection are fork-owned helpers, not local `RoomTimeline` helpers.
- Room-visible seed-prewarm queue state, generation guards, and promise dedupe live behind a
  fork-owned controller hook instead of local `RoomTimeline` refs.
- Thread-open cache hydration, latest-slice refresh, relation backfill, and cached relation-tail
  refresh live behind a fork-owned command controller.
- Thread-open lifecycle orchestration lives behind a fork-owned controller hook.
- Overview resume refresh throttling and relation-cache refresh live behind a fork-owned controller.
- Resume-fetched relation metadata is applied through `useMindroomThreadIndex`; compact cards do not
  wait for an async cache write/read round trip before updating.
- Overview metadata refresh counter subscriptions live behind a fork-owned hook.
- Overview resume refresh target selection lives behind a fork-owned selector; `RoomTimeline` does
  not directly classify visible thread roots for this policy.
- Thread-cache persistence and room-derived thread-cache write queueing live behind a fork-owned
  controller.
- Room cache persistence and cached-back-state refresh live behind a fork-owned lifecycle
  controller.
- Initial room cache hydration lives behind a fork-owned controller while timeline range selection
  remains a narrow callback seam.
- Compact root edit backfill lives behind a fork-owned controller.
- Thread-message edit backfill policy and relation-fetch orchestration live behind fork-owned
  modules.
- Room cache-first back-pagination command bodies live behind a fork-owned controller; `RoomTimeline`
  keeps only virtual-paginator wiring.
- `ThreadRecord.cache` coverage is populated for cached/live/mixed states and is meaningful enough
  to drive "load older messages", tail-loaded, relation-complete, and no-more-history decisions.
- Thread back/front pagination command bodies live behind a fork-owned controller; `RoomTimeline`
  keeps only button wiring and route-specific focus/scroll effects.
- Virtual timeline pagination and event-timeline loading live behind fork-owned controller hooks.
- Live event cache/summary/auto-follow policy lives behind a fork-owned controller hook.

### Phase 6: Isolate Scroll And Pagination

- Extract scroll anchoring, "load more", and thread pagination state into a dedicated controller.
- Connect it to cache coverage metadata.
- Do not introduce virtualization until the controller has stable tests and instrumentation.

Acceptance:

- Loading older thread messages preserves visual anchor.
- Returning from a thread to room overview does not rebuild enough UI to cause visible delay.
- Scroll tests cover cached hydration, live pagination, and mixed cached/live pagination.
- Thread back/front pagination command bodies live behind a fork-owned controller.
- Route focus, pending thread-open, edit-message, unread-anchor, and bottom-pin scroll effects live
  behind a fork-owned controller.
- Jump-to-latest/unread and thread-card open handlers live behind a fork-owned navigation
  controller.

### Phase 7: Shrink Upstream Diffs And Rewrite History

- After behavior is stable, rewrite commits into logical slices:
  - data model and selectors,
  - summary store,
  - tag/status index,
  - compact view conversion,
  - recent threads and command palette conversion,
  - cache/preload controller,
  - scroll/pagination controller.
- Keep upstream Cinny files limited to integration seams.
- Remove abandoned fallback code paths before finalizing history.
- Keep MindRoom message primitives under `src/app/mindroom/messages`; generic message modules may
  expose compatibility re-exports, but should not own the implementation.

Acceptance:

- `git diff v4.11.1...HEAD -- src/app/features/room/RoomTimeline.tsx` is materially smaller.
- MindRoom behavior is mostly contained under fork-owned modules.
- Summary parsing, approval parsing, approval cards, and summary cards live in the MindRoom
  namespace, with old `components/message/*` paths reduced to thin compatibility wrappers.
- Long-text sidecar hydration, AI-run metadata/display helpers, tool-trace parsing, and
  MindRoom block parsing also live in the MindRoom namespace with compatibility wrappers only.
- The AI streaming indicator component and styles live in `src/app/mindroom/messages`.
- AI-run message controls, long-text original download controls, copy-text long-text state, and
  their styles live in `src/app/mindroom/messages`; generic room message rendering only wires the
  `messageExtensions.tsx` seam.
- Live-message collapse policy and the `CollapsibleMessage` UI wrapper live in
  `src/app/mindroom/threads`; the generic room timeline only mounts the fork-owned wrapper.
- Thread event refresh subscriptions live in `src/app/mindroom/threads` with the selectors that
  consume them.
- Page-resume subscriptions for overview refresh live in `src/app/mindroom/threads` with the
  overview resume controller.
- State-event reads for tags, scheduled tasks, headers, and the thread index live in
  `src/app/mindroom/threads` with those selectors.
- Pinned-message cache-aware event lookup and tool approval rendering live behind
  `src/app/mindroom/messages/pinnedMessageExtensions.ts`; the generic pinned-message menu only
  mounts the pinned-message seam.
- Pinned-message MindRoom event-type dispatch also lives behind that same seam; generic
  `RoomPinMenu` should not import MindRoom pinned-event constants or approval renderers directly.
- MindRoom custom-HTML blocks and tool-trace grouping live in `src/app/mindroom/messages`; the
  generic custom HTML parser only delegates to that renderer.
- Local MindRoom settings/provisioning implementation lives in `src/app/mindroom/local-mindroom`;
  generic settings modules only expose route/menu seams.
- The Local MindRoom settings menu item lives in `src/app/mindroom/local-mindroom/settingsMenu.ts`;
  generic settings code only filters and places it.
- The Local MindRoom settings page id and renderer live in
  `src/app/mindroom/local-mindroom/settingsPage.ts` and
  `src/app/mindroom/local-mindroom/settingsRenderer.tsx`; the generic `SettingsPages` enum does not
  own MindRoom page identity.
- The Local MindRoom sidebar shortcut lives in `src/app/mindroom/sidebar`; generic sidebar modules only
  expose the existing navigation seam.
- The Recent Threads UI and summary helper implementation lives in `src/app/mindroom/recent-threads`;
  generic page modules only keep compatibility imports for the page navigation seam.
- Recent Threads persistence atoms live next to that UI in `src/app/mindroom/recent-threads`; `src/app/state`
  only keeps compatibility exports.
- Native app helpers for iOS push, native SSO, and edge-swipe-back live in `src/app/mindroom/native`;
  legacy `utils`/`hooks` paths only keep compatibility exports.
- Route-level edge-swipe back mounting lives in
  `src/app/mindroom/native/MindroomBackRouteHandler.tsx`; the generic back-route component should
  stay a route calculation/render-prop helper.
- Native iOS push settings UI lives in `src/app/mindroom/native/IOSPushNotification.tsx`;
  generic notification settings only mounts it.
- Client-level MindRoom favicon updates, invite notification branding, and native iOS push runtime
  registration live in `src/app/mindroom/client/MindroomClientNonUIFeatures.tsx`; generic client
  non-UI effects only mount that seam.
- Thread streaming-state derivation from `io.mindroom.ai_run`, `io.mindroom.stream_status`, and stop
  reactions lives in `src/app/mindroom/threads`; the old generic hook path is compatibility-only.
- Product branding constants, image assets, and hosted `mindroom.chat` auth policy live in `src/app/mindroom/branding`
  and `src/app/mindroom/auth`; auth/settings/page shells consume those owners rather than duplicating
  product strings and server checks.
- Matrix client same-origin credentials fetch policy lives in
  `src/app/mindroom/matrix/matrixClientFactory.ts`; `src/client/matrixClientFactory.ts` is
  compatibility-only.
- Thread-open navigation seeding lives in `src/app/mindroom/threads/threadNavigation.ts`; generic
  room navigation should build room paths and delegate thread-exit route-state/iOS policy to that
  owner.
- Thread indicator rendering lives in `src/app/mindroom/threads/ThreadIndicator.tsx`; generic reply
  rendering mounts it through `src/app/mindroom/messages/replyExtensions.tsx` and should not own
  activity, resolution, scheduled-task, unread, participant, or reply-count derivation.
- Search-result rendering delegates MindRoom long-text metadata detection to `src/app/mindroom/messages`
  instead of checking raw `io.mindroom.*` keys inside the generic message-search module.
- Generic edit resolution delegates MindRoom message metadata-key ownership to
  `src/app/mindroom/messages/metadata.ts`; upstream-owned utilities should not grow new raw
  `io.mindroom.*` / `com.mindroom.*` prefix checks.
- MindRoom edit-debug flag ownership lives in `src/app/mindroom/messages/editDebug.ts`;
  upstream-owned utilities should not own raw `mindroom.debug.edits` checks.
- MindRoom session cleanup ownership lives in `src/app/mindroom/cache/sessionCleanup.ts`;
  client startup/logout code should call that boundary instead of importing individual fork caches,
  recent-thread stores, iOS push state, or raw `mindroom-*-event-cache` names.
- MindRoom multi-account session store key/event ownership lives in
  `src/app/mindroom/cache/sessionStoreConfig.ts`; generic session state should expose compatibility
  constants but not own raw MindRoom storage strings.
- MindRoom startup route-restore and alias-canonicalization policy lives in
  `src/app/mindroom/routing/clientRouteRestore.ts`; `ClientLayout` should remain a narrow React
  integration point for those effects.
- Last-open-thread persistence lives in `src/app/mindroom/threads/lastOpenThread.ts`;
  `src/app/state/lastOpenThread.ts` is compatibility-only and session cleanup reaches it through
  the MindRoom cleanup boundary.
- Scheduled-thread state parsing, counts, header labels, and hooks live in `src/app/mindroom/threads`;
  legacy hook/util paths are compatibility exports only.
- Thread activity timestamp derivation lives in `src/app/mindroom/threads/useThreadLastActivityTs.ts`;
  legacy hook paths are compatibility exports only.
- Cache-aware room/thread event lookup lives in `src/app/mindroom/threads/useRoomEvent.ts`, next to the
  event repository it uses; the generic hook path is compatibility-only.
- Thread timeline SDK state, render-state merging, thread event lookup maps, and thread pagination
  token derivation live behind `src/app/mindroom/threads/useThreadTimelineState.ts`; `RoomTimeline`
  consumes that snapshot instead of assembling these thread details inline.
- MindRoom preload limit constants, sanitization, and the settings tile live in
  `src/app/mindroom/threads/preloadSettings.ts` and `src/app/mindroom/settings`; generic settings
  state only persists the value and generic settings UI only mounts the fork-owned tile.
- MindRoom settings integration lives in `src/app/mindroom/settings/settingsMenuExtensions.ts` and
  `src/app/mindroom/settings/settingsExtensions.tsx`; generic settings menu/page/general sections
  should mount those seams rather than importing concrete Local MindRoom or preload setting modules.
- Rebase conflicts are expected and localized.

## Testing Strategy

Required test layers:

| Layer             | Tests                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Codec tests       | Summary event parsing, edits, legacy/current formats.                                         |
| Selector tests    | `ThreadRecord` derivation from live-only, cache-only, and mixed inputs.                       |
| Store tests       | Summary/tag/status state updates and precedence.                                              |
| Cache tests       | Raw event persistence, coverage metadata, index record persistence, migration behavior.       |
| View-model tests  | Compact card, badge, header, recent thread, and command palette all agree.                    |
| Controller tests  | Preload policy stops at limit, includes non-visible current-room threads, resumes from cache. |
| Browser/MCP tests | Compact room, normal room, thread open, thread back navigation, long-thread load-more anchor. |

Architecture guardrails should prefer behavior/API tests over broad source-string assertions. Keep
only narrow import-boundary tests when a direct behavior assertion would be weaker or much more
expensive.

Every behavior-changing step should run:

```bash
npm test
npm run typecheck
npm run build
```

Before continuing past a refactor slice, branch health should be explicit:

```bash
npm run lint
git diff --check
```

Docs-only or plan-only steps should run:

```bash
git diff --check
```

## Success Criteria

The refactor is complete when:

- There is exactly one canonical way to derive a thread's summary, counts, previews, tags, status, and activity.
- Cache can instant-paint the current room and threads up to the configured preload limit.
- Current-room preload includes non-visible threads and all supported message/media event types.
- Compact view, normal room view, thread banner, recent sidebar, and command palette agree for the same thread.
- `RoomTimeline.tsx` is no longer the owner of summary/cache/preload/thread-card data derivation.
- Upstream Cinny file diffs are narrow enough that rebases are mostly mechanical.
- Defensive fallback paths that were only added to paper over earlier bugs have been removed.
