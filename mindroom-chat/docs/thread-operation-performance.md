# Large-room thread operation profile

## Changes and motivation

Chrome profiling of a live Personal room found repeated room-wide tag aggregation and SDK event searches during normal thread actions.
A synchronous tag pass over 516 SDK threads and 614 tag-state events took about 1.83 seconds; sharing the parsed state snapshot reduced that isolated pass to about 3.7 ms in three comparisons.
That approximately 99.8% component reduction is not a whole-application speedup.

Cross-room indexing now parses tag state once per room per synchronous flush, including explicit empty snapshots for untagged roots.
Canonical and legacy tag changes invalidate their named root; pin changes still reconcile the room.
Room ordering scans history backwards without copying it, computes each activity timestamp once per sort, and shares one room receipt per unread pass.
Disabled compact discovery keeps known root fallbacks without computing unused ordering or unread state.

Boolean readiness checks use an already-known SDK root before searching every thread timeline.
Lookups that select event content retain their original source precedence.
The overview metadata hook avoids an unnecessary empty snapshot on mount.
Cache hydration keeps bounded database reads, publishes its first useful batch promptly, then combines fast results for up to 250 ms before publishing again.
A deadline publishes completed updates even if a later read stalls.
Cancellation discards derived values and requests prompt fresh publication on the next pass, preserving progress during streaming.
Within one mounted hook, effect restarts share pending reads for the same session, room, event limit, and root set.
Only pending read promises are shared; current live records govern derivation, and completed or failed reads are evicted.

## Workload and measurement

The baseline is merged PR #319, commit `59dd75c21658feb47aed97d480b886977a3c372a`, including its independent cache/server thread-loading fixes.
The measured candidate is `c37c08a8`.
Later review follow-ups consolidate the identical readiness checks and share pending cache reads across hydration restarts; the table does not quantify their incremental effect.
The disposable loopback fixture has 1,000 roots, 100 original logical replies per root, and three replacement events per original reply: 401,000 historical message events.
Earlier streaming replays remain in the fixture; these operation comparisons add no messages.
An additional 614 canonical tag-state events make the state volume comparable to the profiled Personal room.

Measurements use production builds in headed Google Chrome 153.0.8010.53 at 1440 × 907, without CPU or network throttling.
The candidate was built with Node 24.13.1.
The measured baseline was initially built with Node 26; rebuilding it with Node 24.13.1 and the same build-version stamp produced byte-identical JavaScript for all 12 emitted assets.
Each run starts a fresh browser context and renders all 1,000 compact cards, with filters set to include both resolved and unresolved threads.
After initial loading, each run opens the same thread, resolves it, unresolves it, and closes it, three times.
Each action is separated by at least 1.5 seconds without a long task.
Runs use candidate/baseline/baseline/candidate order, giving two browser contexts and six observations per action per build.
No competing builds or test suites run during these measurements.

Visible readiness includes Playwright actionability and the wait for the observed UI state.
Opening requires the thread route, context banner, and a visible message; it does not require all historical replies to finish loading.
Resolve/unresolve requires the banner button to change state.
Closing requires the banner to disappear and all 1,000 overview cards to be mounted in the DOM.
Main-thread work is the Chrome DevTools Protocol `TaskDuration` delta through the post-action settling window, so it includes work after the first visible result.
CPU profiles and raw timings remain local; the existing reusable seeder and Chrome streaming probe are unchanged.

## Results

The following values are medians of six observations per build.
Percentages describe reductions in elapsed time or processing work, calculated as `(baseline - candidate) / baseline`.

| Operation / metric           | Baseline (ms) | Candidate (ms) | Reduction |
| ---------------------------- | ------------: | -------------: | --------: |
| Open: visible readiness      |         420.0 |          329.2 |     21.6% |
| Resolve: visible readiness   |       1,114.4 |          239.6 |     78.5% |
| Unresolve: visible readiness |       1,147.5 |          245.2 |     78.6% |
| Close: visible readiness     |       2,487.0 |        2,139.9 |     14.0% |
| Open: main-thread work       |         463.5 |          417.6 |      9.9% |
| Resolve: main-thread work    |       1,113.6 |          246.2 |     77.9% |
| Unresolve: main-thread work  |       1,141.2 |          237.4 |     79.2% |
| Close: main-thread work      |       9,930.6 |        7,777.5 |     21.7% |

Resolve and unresolve show the strongest separation: every candidate observation is faster than every baseline observation.
Open and close timings overlap and have smaller improvements, so those percentages need more samples before predicting production gains.
Returning to the overview still triggers several seconds of processing after the first visible result.

Raw visible-readiness observations, in milliseconds:

| Build/run   | Open                | Resolve                   | Unresolve                 | Close                     |
| ----------- | ------------------- | ------------------------- | ------------------------- | ------------------------- |
| Candidate 1 | 465.5, 352.1, 297.1 | 408.3, 235.8, 243.4       | 424.4, 222.4, 236.3       | 2,542.4, 2,115.7, 2,429.3 |
| Baseline 1  | 510.3, 439.0, 292.7 | 1,024.9, 1,072.8, 1,106.7 | 1,093.6, 1,201.4, 1,229.6 | 2,556.9, 2,821.5, 2,417.2 |
| Baseline 2  | 428.9, 304.1, 411.0 | 1,122.1, 1,426.3, 1,414.3 | 1,746.9, 973.1, 971.8     | 3,119.0, 2,291.1, 2,224.2 |
| Candidate 2 | 393.8, 282.3, 306.4 | 318.3, 232.2, 229.8       | 254.0, 232.9, 254.5       | 2,164.1, 2,051.2, 2,103.7 |

Initial loading shows no meaningful improvement:

| Build/run   | All cards rendered (s) | Settled (s) | Main-thread work (s) |
| ----------- | ---------------------: | ----------: | -------------------: |
| Candidate 1 |                 53.380 |      58.717 |               57.359 |
| Baseline 1  |                 50.924 |      56.872 |               55.132 |
| Baseline 2  |                 54.449 |      59.935 |               58.643 |
| Candidate 2 |                 51.393 |      56.479 |               55.308 |

The mean time until all cards are mounted falls only 0.6%, much smaller than the run-to-run variation.
This PR does not establish an initial-load speedup.

## Remaining limits

These small local samples measure this workload, not a guaranteed production percentage.
The measurements do not establish a scrolling frame-rate improvement or a faster complete thread-history load.
Overview record derivation, broad SDK searches, and rendering all 1,000 cards remain substantial costs.
Broad event lookup changes require preserving SDK timeline ownership and event-source precedence; this PR changes only readiness checks where source identity does not affect the result.
Use the [existing fixture instructions](testing.md#streaming-stress-fixture) to reproduce the room and retain it across before/after comparisons.
