// CINNY-207 P6.1 / D4 (Commit 4): the legacy `paginationLimit` policy
// (DEFAULT_PAGINATION_LIMIT / MIN / MAX / sanitizePaginationLimit) was
// deleted alongside `MindroomMessagePreloadLimitSetting`. The user-
// facing depth setting now lives at `prefetchDepth` in
// `mindroom/settings/mindroomSettings.ts` and is sanitized by
// `sanitizePrefetchDepth` in `engine/prefetchPolicy.ts`.
//
// What remains here is three engine-adjacent batch/debounce constants
// that predate the D4 replacement and are consumed outside the settings
// layer. `ROOM_CACHE_PERSIST_DEBOUNCE_MS` (P1.1's sweep debounce) went
// with the P3.3 strip; the sweep it debounced no longer exists.

// Batch size for thread `/relations` fetches (SDK bootstrap fallback,
// pagination command controller, overview resume). Kept in sync with
// the reconciler's `RELATIONS_PAGE_LIMIT` at the doc level.
export const THREAD_BATCH_SIZE = 200;

// Batch size for interactive room pagination. Caps the cache-page
// prefetch when the user scrolls back — bigger jumps still fetch, but
// the initial batch is bounded so the render pass stays fast.
export const ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE = 200;

// Scroll-driven thread back-pagination headroom, in virtual rows. When
// the FIRST rendered virtual row's index drops to or below this value
// while older content exists, back-pagination auto-fires — the same
// cache-first, anchor-restoring pipeline as the "Load Older Messages"
// chip, started ~2 mobile viewports (15 rows × ~96-144px estimates)
// BEFORE the user's momentum scroll slams into the top of the loaded
// window. Rooms have always had this via useVirtualPaginator's
// IntersectionObserver sentinel; threads bypass that paginator
// (virtualizer count is threadEvents.length), so the thread path needs
// its own trigger. Without it, upward scrolling on a slow connection
// hard-stops at the loaded-window edge until a manual chip tap or a
// background band arrival extends the window — the jagged
// stop-load-continue reported on mobile (task #125).
export const THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS = 15;

// CINNY-207 P1.4: per-target trailing debounce for edit-compaction
// upserts. The live path never persists standalone m.replace records;
// it instead coalesces upserts of the target's cache record with the
// latest bundled edit (finding F5 / decision D5). This IS the stream-
// end flush: each new edit resets the timer, so the trailing write
// always carries the final content of the stream, landing ≤1 s after
// the last edit. Unmount and pagehide/visibilitychange-hidden also
// flush pending upserts synchronously. Lives in this leaf module so
// tests can mock it without loading the engine module graph.
export const THREAD_EDIT_COMPACTION_DEBOUNCE_MS = 1000;
