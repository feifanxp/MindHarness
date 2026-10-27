# Timeline Debugging Playbook

## Purpose

This is the short, durable playbook for future room/thread debugging sessions.

It is intentionally separate from `FORK_CHANGES.md`.

- `FORK_CHANGES.md` is the living runbook for the current branch state.
- This file captures reusable lessons, debugging workflow, and evidence standards.

## Start Here

1. Read the top of `FORK_CHANGES.md`.
2. Identify the current baseline branch/commit before changing code.
3. Do a live repro before proposing architecture changes.
4. Enable timeline tracing before touching behavior:

```js
localStorage.setItem('mindroom.debug.timeline', '1');
location.reload();
```

## Hard Rules

### Do Not Trust Intuition Over Trace Data

The UI often makes different bugs look the same:

- partial cache hit,
- false completeness metadata,
- bad bootstrap decision,
- render-range truncation,
- stale gap token,
- per-item network fallback,
- or just virtualization hiding most rows.

Always get logs first.

### Treat “Looks Cached” And “Is Complete” As Different Questions

A thread can:

- open quickly,
- show many messages,
- and still be incomplete or marked with the wrong gap state.

Likewise, a thread can be fully local while the DOM only shows a small visible subset.

### Do Not Refactor Blind

Several hours were lost by improving plausible code paths without first proving which handoff was
actually wrong.

Prefer:

1. narrow live diagnosis,
2. narrow fix,
3. focused regression,
4. live recheck,
5. only then decide whether the design itself needs cleanup.

## The Most Useful Tools

### 1. Chrome DevTools MCP

Use it to verify:

- the real current tab,
- console timeline-debug messages,
- network fan-out,
- and whether the DOM is missing data or just virtualizing it.

Useful checks:

- `list_console_messages`
- `get_console_message`
- `list_network_requests`
- `take_snapshot`
- `evaluate_script`

### 2. Timeline Debug Trace

The trace points that paid off most:

- `room-surface`
- `eager-preload-start`
- `eager-preload-batch`
- `eager-preload-complete`
- `thread-open-seed-scan`
- `thread-open-seed-applied`
- `thread-open-live-seed-applied`
- `thread-cache-hydrate-start`
- `thread-cache-hydrate-page`
- `thread-cache-hydrate-applied`
- `thread-open-complete-cache-hit`
- `thread-open-complete`
- `thread-range`
- `render-state`

These let us answer:

- what was locally available,
- what got rendered first,
- what got hydrated later,
- and whether extra network work was justified.

### 3. IndexedDB / Cache Inspection

When a thread “should be cached,” inspect the actual stored payload.

Questions to answer:

- how many direct `m.thread` replies are present?
- how many `m.replace` relations are present?
- what does `expectedReplyCount` say?
- is `snapshotComplete` true or false?
- is `relationSnapshotComplete` true or false?
- is `tailLoaded` true or false?
- is there a `beforeToken`?

Several real bugs were only obvious once the persisted thread snapshot was inspected directly.

## Evidence Standards

Mark conclusions explicitly as one of:

### Proven

Supported by:

- live MCP logs,
- IndexedDB contents,
- or focused tests reproducing the exact path.

### Strong Theory

Plausible and consistent with logs, but not yet isolated by a direct repro or trace.

### Symptom Guardrail

A patch that improves behavior but may not be the root-cause fix.

Keep these categories distinct in notes and commit messages.

## Common Failure Patterns

### 1. Thin First Paint, Rich Later Hydrate

Symptom:

- thread opens with a few rows,
- then fills in after cache/network work.

Typical cause:

- first paint seeded from a weak source,
- richer local snapshot arrived later.

### 2. False “Load Older Messages”

Symptom:

- thread already looks complete,
- but still shows the older-gap chip.

Typical cause:

- stale backward token in the SDK timeline,
- even though cache metadata proves no backward gap.

### 3. Partial Snapshot Marked Complete

Symptom:

- cache hit occurs,
- but later network fetch discovers more replies.

Typical cause:

- `snapshotComplete` or expected reply count was persisted incorrectly,
- or a partial room-derived snapshot downgraded a stronger thread snapshot.

### 4. Per-Item Fetch Fan-Out After Cache Hit

Symptom:

- thread is local,
- but opening it still triggers many `/event/<id>` or `/relations/<id>/m.replace/...` calls.

Typical cause:

- cache hit still falls into bootstrap or edit-backfill logic,
- or reply/event lookup hooks are allowed to fetch on the hot path.

### 5. Rendered Subset Mistaken For Missing Data

Symptom:

- only a fraction of rows appear in the DOM.

Typical cause:

- virtualization / viewport subset,
- not missing local data.

Check:

- `render-state` counts,
- scroller `scrollHeight`,
- and the actual cached event counts.

## Safe Workflow For Fixes

1. Reproduce live on one exact room/thread URL.
2. Capture the relevant trace ids and counts.
3. Write one narrow fix.
4. Add one regression test for that exact handoff.
5. Run:
   - focused Vitest
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
6. Do bounded review.
7. Re-run the same live MCP repro.
8. Record evidence in `FORK_CHANGES.md`.

## Practical Lessons From This Session

### Observability First Was The Turning Point

The biggest improvement was not a code change. It was adding the timeline debug trace.

Without it, multiple distinct bugs looked like “cache doesn’t work.”

### The Current UI Can Have More Than One Bug At Once

We repeatedly found:

- real cache bugs,
- real metadata bugs,
- and real first-paint handoff bugs,

at the same time.

That means “a fix was real” does not imply “the user-visible problem is solved.”

### Restarting From A Cleaner Baseline Helped

The recovery branch based on `96b13bcc` was useful because it removed a noisy stack of later
changes and made new regressions easier to reason about.

### Keep Notes Durable

If a conclusion is important, record:

- exact room/thread ids,
- exact trace fields,
- exact counts,
- exact commit ids,
- what was proven,
- and what remains theory.

Future debugging sessions should not need to reconstruct that from memory.
