# Large-room streaming profile

## Workload and method

The local fixture contains 1,000 thread roots and 100 original replies per root.
Each reply starts as a pending notice and receives three replacements, ending as a completed text message.
That is 401,000 historical message events: 1,000 roots, 100,000 replies, and 300,000 edits.
Historical seeding is distinct from the live replay measured in Chrome.
Each replay adds 20 replies to the same first 20 roots and sends 20 replacements per reply, with a 50 ms pause between concurrent batches.
Completion requires all 20 compact-card previews to contain their final unique marker and clear the streaming indicator.
Replies added by earlier measurements remain in the room and are reported separately from the initial fixture.

The wire format follows `src/mindroom/streaming.py`, `src/mindroom/matrix/message_builder.py`, and `src/mindroom/matrix/client_delivery.py` in MindRoom at `0ba8f36ad63b241e83543f49c322116c1dd08f24`.
The stable transaction IDs and real Matrix sends follow the approach in `scripts/testing/fuzz_live_matrix.py`.
This fixture does not call an LLM or claim coverage of the backend's complete fuzz scenarios.

Measurements use headed Google Chrome 153.0.8010.53, a 1440 × 1000 viewport, production builds, a fresh browser context per run, and a loopback Tuwunel server.
No CPU or network throttling is applied.
The initial baseline was Chat commit `987836258d46eb4be104638817b467bb1c5110f9`.
After the independent compact-thread optimizations in PR #315 landed, the second comparison uses baseline `d58051e6efe1d4e3367004799cc998586c7b3d14` and integrated candidate `4fb70e22`.
PRs #317 and #318 were integrated later during merge review; the comparisons below predate those changes and do not quantify the final merged branch's incremental benefit.
Builds use the repository's Node 24.13.1.
Main-thread task duration comes from Chrome DevTools Protocol, with V8 CPU profiles, animation-frame gaps, and long-task observations captured during each burst through final preview catch-up.
The measurements are local observations, not CI timing thresholds or production service-level guarantees.

## Changes

CPU profiles identify repeated `Intl.NumberFormat` construction while rebuilding 1,000 card labels.
Count formatting now reuses one formatter for the current locale and replaces it when the locale changes.

Streaming-state checks also decoded and deeply cloned the same bundled replacement twice.
The eligibility check now passes its already detached replacement to the shared edit resolver.
The resolver retains sender validation, ordering, redaction handling, and metadata fallback behavior.
No persistent replacement cache is introduced, so later in-place Matrix updates remain visible.

## Results

### Measured base after PR #315

The checked-in Chrome probe ran three alternating baseline/candidate pairs without competing test suites or builds.
All six runs verified 1,000 roots and at least 100 replies per root, then rendered all final previews and cleared their streaming indicators.
The pre-replay reply total grew from 100,200 to 100,300 across these runs; each run added another 20 replies.

| Build/run       | Open all cards (s) | Send 400 edits (s) | Catch-up after sends (s) | Main-thread work (ms) | Long tasks (ms) | Frame-gap p95 (ms) |
| --------------- | -----------------: | -----------------: | -----------------------: | --------------------: | --------------: | -----------------: |
| Measured base 1 |             21.710 |              1.497 |                    0.993 |                 2,846 |           2,178 |              349.9 |
| Optimized 1     |             19.795 |              1.629 |                    1.224 |                 3,293 |           2,400 |              375.0 |
| Measured base 2 |             24.575 |              1.572 |                    1.141 |                 3,125 |           2,452 |              333.5 |
| Optimized 2     |             17.598 |              1.675 |                    0.778 |                 2,896 |           2,036 |              291.5 |
| Measured base 3 |             19.914 |              1.662 |                    1.149 |                 3,165 |           2,752 |              333.6 |
| Optimized 3     |             17.707 |              1.527 |                    0.569 |                 2,553 |           1,744 |              309.3 |

Mean main-thread work fell from 3,046 ms to 2,914 ms, approximately 4%.
Mean long-task time fell from 2,461 ms to 2,060 ms, approximately 16%.
The first optimized run was slower, so these small-sample averages do not establish a stable improvement of either size.
Room opening and catch-up also varied; the individual timings remain visible rather than advertising guaranteed percentages.
This comparison supersedes the earlier percentages below only for the measured base `d58051e6`.

### Original base before PR #315

| Build/run                   | Open all cards (s) | Send 400 edits (s) | Catch-up after sends (s) | Main-thread work (ms) | Long tasks (ms) | Frame-gap p95 (ms) |
| --------------------------- | -----------------: | -----------------: | -----------------------: | --------------------: | --------------: | -----------------: |
| Baseline 1                  |             30.957 |              1.901 |                    1.114 |                 3,025 |           2,577 |              375.0 |
| Baseline 2                  |             34.505 |              1.477 |                    1.154 |                 2,641 |           2,332 |              425.5 |
| Optimized 1                 |             20.945 |              1.543 |                    0.916 |                 2,473 |           2,030 |              308.3 |
| Optimized 2                 |             20.749 |              1.647 |                    0.785 |                 2,461 |           2,036 |              341.7 |
| Baseline 3, rerun afterward |             23.575 |              1.618 |                    1.354 |                 2,984 |           2,588 |              399.9 |

All five overview bursts reached their final previews.
Mean measured main-thread work fell from 2,884 ms to 2,467 ms, approximately 14%.
Mean long-task time fell from 2,499 ms to 2,033 ms, approximately 19%.
The later baseline confirms the burst improvement, while its faster opening shows why the larger initial open-time reduction should not be treated as a stable percentage.
These are small samples with varying delivered send rates, so the table retains individual observations.

An open-thread check, positioned at its latest reply, also rendered the final replacement in both builds.
It recorded no long tasks, with 1,394 ms baseline and 1,559 ms optimized task duration at different send durations of 1.523 s and 1.711 s.
That single pair does not demonstrate an active-thread speedup.
An earlier thread probe left the viewport at old messages and timed out waiting for visible final text; it is excluded from performance comparisons.

The initial full-size measurements used an investigative prototype of the checked-in probe.
It used the same 20-stream/400-edit workload, a five-second settling pause before creating pending replies, and one additional 50 ms pause after the last batch.
The dedicated probe adds live count validation and structured Playwright attachments for subsequent reproduction.

## Reproduction and remaining limits

Follow the [streaming stress fixture instructions](testing.md#streaming-stress-fixture) to seed and verify the room, then run the dedicated live probe against each production build.
Run measurements without competing builds, test suites, or other browser probes.
Retain the fixture manifest and Matrix data for repeated comparisons.

The room overview still mounts all 1,000 cards and remains expensive during bursts.
Profiles also show repeated SDK event lookups; changing event-source precedence needs separate correctness coverage.
Heap observations are not garbage-collection-normalized and are not used as evidence of a memory improvement.
Some compact-card reply counts reflect partial client history even when the server's thread counts are complete.
The probe verifies server counts and rendered final previews independently of those labels.
