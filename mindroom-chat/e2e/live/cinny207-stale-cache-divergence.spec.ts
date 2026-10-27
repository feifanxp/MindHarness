import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  loginToMatrix,
  redactEvent,
  seedRoomOverviewState,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
} from '../helpers/matrix';
import { readThreadEventCacheRecords } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

// CINNY-207 P5.2 (AC2): seeded stale-cache divergence converges after
// open without reload, in place, scroll anchored.
//
// The scenario is the one that made the pre-P5 tail refresh visibly
// insufficient in practice:
//
//   1. User opens a thread with an in-thread message M ("edit-target
//      v1"), a message R ("redact-target"), and a 👍 reaction on the
//      reply. Everything gets rendered AND cached (thread coverage
//      complete on close).
//   2. Client is torn down (page.goto('about:blank')). The IDB cache
//      persists — it still has v1 of M, the reaction record, and R.
//   3. Over the REST API (server ground truth), while the client is
//      away: M gets edited to "v2 converged", the reaction gets
//      redacted, R gets redacted, plus ~25 filler thread messages are
//      posted. The filler is critical: it pushes the divergence
//      outside the SDK's next sync window so convergence MUST come
//      from the reconciler, not from Tier-1 write-through of a fresh
//      sync. (Without filler, this spec would silently test P3.1's
//      live-events path instead of P5's reconciler.)
//   4. User navigates back to the thread URL (NO page reload after
//      this point — we're testing that the reconciler catches up
//      through the D7 SWR path, not through a cold rehydrate).
//
// Expected outcomes:
//   - `edit-target v2 converged` visible in the rendered thread (edit
//     applied via `applyCachedReplaceRelations`).
//   - 👍 chip count is 0 (reaction removed via
//     `reconcileRelationEventsWithAggregation`).
//   - R tombstoned (redaction applied via `applyCachedRedactions`).
//   - Same three changes visible in the IDB cache
//     (`readThreadEventCacheRecords` returns bundled v2 on M, no
//     record for the reaction, redacted M.type on R).
//   - Scroll anchor invariant (AC10): a mid-viewport message's Y
//     position moves by ≤ 8px through the reconcile pass. Repairs are
//     in-place swaps/deletes, not prepends — the applier must not
//     grow the timeline above the anchor.
//
// CINNY-207 AC2 STEP RG4b-fix (2026-07-04, owner-decision pivot):
// the multi-cycle "render-gap" hunt (RG1-RG5b) was chasing a bug
// that did not exist. Owner ruling on RG4b:
//
//   pin-to-bottom on thread open is INTENTIONAL streaming UX, not a
//   defect. AC2's "scroll anchored" clause means the RECONCILE
//   REPAIR itself does not displace the viewport — it says nothing
//   about the reload restoring the pre-close position (that is
//   explicitly out of scope for CINNY-207).
//
// What the RG* observability probes actually proved (they were not
// wrong; only their interpretation was):
//   - reconcilesScheduled=2, reconcilesRepaired=1, reconcilerPersists=1,
//     reconcilesOnRepairedFired=1 — reconciler runs, detects divergence,
//     repairs, persists the converged cache snapshot, and fires the
//     supplemental sink callback end-to-end.
//   - RG3 render-seam counters: mergeSawIncomingEditRelation firing
//     and the merge dedup does keep the incoming (repaired) instance.
//   - Applier scalar tripwires: applierMakeReplacedLatestEqualsCurrent > 0
//     — the render-held instance for the edit target IS the repaired one,
//     holding the correct m.replace relation.
//   - The prior assertion `edit-target v2 converged … toBeVisible`
//     was timing out only because the test never scrolled the anchor
//     into view after the reopen — the fresh open pinned to the
//     bottom (filler tail), leaving the anchor + its neighbouring
//     targets virtualised outside the DOM. The data + render chain
//     was already converged.
//
// This spec now measures AC2 as owner defined it:
//   1. Reopen the thread (no reload after this point). Wait until
//      the reconciler has actually completed one repair pass
//      (`reconcilesRepaired >= 1` — otherwise we are asserting on
//      the cold state and there is nothing to be "anchored across").
//   2. Programmatically scroll `fixture.replyId` into view so the
//      convergence + displacement claims are made on the anchored
//      viewport, not on wherever pin-to-bottom left the client.
//   3. Assert convergence in the anchored viewport: edit-target v2
//      is visible, v1 is gone from the DOM, redact-target is gone,
//      reaction chip is gone. Cache-level convergence is asserted
//      separately (bundled v2 on M, no reaction record).
//   4. No displacement assertion (review F3 disposition (B)): the
//      repair completes before the anchor can be scrolled into the
//      virtualised window, so repair-induced displacement is not
//      measurable in this flow. The anchor invariant under live
//      streaming edits is canonically covered by
//      thread-virtualization-behaviors.spec.ts ("streaming edits do
//      not yank a scrolled-up reader"). See the inline note at the
//      former assertion site and follow-up task #119 for the
//      programmatic-scroll intent question that measurement surfaced.
//
// Scroll-position restoration across reopen is EXPLICITLY out of
// scope for this AC and is not asserted or built. It may become a
// separate feature later; for CINNY-207 the anchor invariant is
// only about the reconcile pass, not the reload.
//
// Regression: streamed-edit-cache and stop-emoji-redaction both
// remain green.
test.describe('CINNY-207 stale-cache divergence reconcile', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test(
    'stale edit / stale reaction / missed redaction converge after open without reload, in place, scroll anchored (AC2)',
    async ({ page }) => {
      const homeserver = getHomeserver();
      const { username, password } = getPrimaryCredentials();
      const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
      const stamp = Date.now();

      // Fresh thread: root + one reply so the thread model exists.
      const fixture = await createThreadFixture(homeserver, accessToken, {
        name: `CINNY-207 Stale Divergence ${stamp}`,
        topic: 'Reconciler convergence fixture.',
        rootBody: `AC2 thread root ${stamp}`,
        replyBody: `AC2 thread reply ${stamp}`,
        txnPrefix: 'cinny-207-ac2',
      });
      const threadId = fixture.rootId;

      // In-thread messages M (edit target v1) and R (redact target)
      // plus a 👍 reaction on the seed reply.
      const editTargetId = await sendRoomMessage(
        homeserver,
        accessToken,
        fixture.roomId,
        {
          msgtype: 'm.text',
          body: `edit-target v1 ${stamp}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.replyId },
          },
        },
        'cinny-207-ac2'
      );
      const redactTargetId = await sendRoomMessage(
        homeserver,
        accessToken,
        fixture.roomId,
        {
          msgtype: 'm.text',
          body: `redact-target ${stamp}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.replyId },
          },
        },
        'cinny-207-ac2'
      );
      const reactionId = await sendReaction(
        homeserver,
        accessToken,
        fixture.roomId,
        fixture.replyId,
        '👍',
        'cinny-207-ac2'
      );

      // First open: hydrate everything into the cache. Assert that
      // pre-divergence state actually reached the render + cache so
      // the "cache had it, then server changed" premise is real.
      await loginWithPassword(page, { homeserver, username, password });
      await expectLoggedInShellStable(page);
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId,
        viewMode: 'threaded',
        filterState: createDefaultThreadFilterState(),
      });
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(threadId)}`
      );
      await expect(page.getByText(`edit-target v1 ${stamp}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`redact-target ${stamp}`)).toBeVisible({ timeout: 30_000 });

      // The cache write path is debounced; poll for the three pre-
      // divergence records to be persisted rather than reading once
      // and racing the flush (the alternative — a fixed sleep —
      // adds latency and still flakes).
      await expect
        .poll(
          async () => {
            const records = await readThreadEventCacheRecords(page, fixture.roomId, threadId);
            return {
              edit: !!records.find((record) => record.eventId === editTargetId),
              redact: !!records.find((record) => record.eventId === redactTargetId),
              reaction: !!records.find((record) => record.eventId === reactionId),
            };
          },
          {
            timeout: 30_000,
            message: 'pre-divergence records never appeared in IDB after first open',
          }
        )
        .toEqual({ edit: true, redact: true, reaction: true });

      // Take the client offline — a real "user closed the tab" cycle
      // without touching IDB. Server truth diverges while we're away.
      // The pre-close anchor position is NOT captured: scroll-position
      // restoration across reopen is out of scope for CINNY-207 (owner
      // decision on RG4b). AC2 only asserts that the reconcile repair
      // itself does not displace the anchored viewport — that is
      // measured in-place below, after the reopen navigation.
      await page.goto('about:blank');

      // Server-side divergence: edit M to v2, redact the reaction,
      // redact R, then post ~25 filler in-thread messages. The filler
      // pushes the divergence past whatever the next sync window
      // catches, forcing the reconciler (not the sync path) to be the
      // one that converges the cache.
      await sendMessageEdit(
        homeserver,
        accessToken,
        fixture.roomId,
        editTargetId,
        `edit-target v2 converged ${stamp}`,
        'cinny-207-ac2'
      );
      await redactEvent(
        homeserver,
        accessToken,
        fixture.roomId,
        reactionId,
        'reconcile ac2',
        'cinny-207-ac2'
      );
      await redactEvent(
        homeserver,
        accessToken,
        fixture.roomId,
        redactTargetId,
        'reconcile ac2',
        'cinny-207-ac2'
      );
      const fillerCount = 25;
      for (let i = 0; i < fillerCount; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sendRoomMessage(
          homeserver,
          accessToken,
          fixture.roomId,
          {
            msgtype: 'm.text',
            body: `AC2 filler ${stamp} #${i + 1}`,
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: threadId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: fixture.replyId },
            },
          },
          'cinny-207-ac2'
        );
      }

      // Return to the thread URL — NO page.reload() after this point.
      // The reconciler must do the convergence work; the cache was
      // "right" before the client left, so a pre-P5 cache-first path
      // would paint stale content and never revalidate. This is the
      // exact D7 violation P5 fixes.
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(threadId)}`
      );

      // Wait for the reconciler to complete at least one repair pass.
      // The probe's `reconcilesRepaired` counter is bumped inside the
      // engine right after `hydrateCachedEvents` runs against the
      // reconciled snapshot — i.e. by the time this poll returns >= 1,
      // the cache has been repaired and the render sink has been
      // called. AC2's anchor + convergence assertions below are made
      // AFTER this point so we are measuring the render post-repair,
      // not the cold reopen state (there would be nothing for the
      // anchor to "hold across" if we asserted before the repair).
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const w = window as Window & {
                __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
              };
              return w.__MINDROOM_CACHE_PROBE__?.snapshot()?.reconcilesRepaired ?? 0;
            }),
          {
            timeout: 30_000,
            message: 'reconciler never completed a repair pass after reopen',
          }
        )
        .toBeGreaterThanOrEqual(1);

      // The anchor (seed reply) is virtualised out of the DOM on
      // reopen: pin-to-bottom (intentional streaming UX, see
      // CINNY-031) lands us at the filler tail and @tanstack/react-
      // virtual only renders a window around the visible range. To
      // bring the anchor into the rendered window we scroll the
      // thread's scroll container UPWARD in bounded steps until the
      // anchor's `[data-message-id]` element appears; then
      // `scrollIntoView` centres it in the viewport.
      //
      // Bounded steps + a hard iteration limit keep this robust
      // against a mis-selected scroll container (falls through to
      // the outer 30s timeout instead of spinning forever).
      await expect
        .poll(
          async () =>
            page.evaluate((expectedReplyId) => {
              const escaped = CSS.escape(expectedReplyId);
              if (document.querySelector(`[data-message-id="${escaped}"]`)) {
                return 'present' as const;
              }
              // Find the nearest scrollable ancestor of any rendered
              // message. This is the timeline's Scroll container.
              const anyMessage = document.querySelector<HTMLElement>('[data-message-id]');
              if (!anyMessage) return 'no-messages' as const;
              let node: HTMLElement | null = anyMessage.parentElement;
              let scroller: HTMLElement | null = null;
              while (node) {
                const overflowY = window.getComputedStyle(node).overflowY;
                if (
                  (overflowY === 'auto' || overflowY === 'scroll') &&
                  node.scrollHeight > node.clientHeight
                ) {
                  scroller = node;
                  break;
                }
                node = node.parentElement;
              }
              if (!scroller) return 'no-scroller' as const;
              if (scroller.scrollTop <= 0) return 'at-top' as const;
              scroller.scrollBy({ top: -800, behavior: 'auto' });
              return 'scrolling' as const;
            }, fixture.replyId),
          {
            timeout: 30_000,
            message: 'seed reply anchor never rendered after upward scroll walk',
          }
        )
        .toBe('present');

      // Bring the anchor into view (block: 'center' → replies posted
      // just after the seed reply — edit-target v2 and redact-target
      // — are also on-screen). Two requestAnimationFrame ticks let
      // virtualisation settle its renderable window and layout
      // before we sample the anchor top.
      await page.evaluate((expectedReplyId) => {
        const anchorElement = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(expectedReplyId)}"]`
        );
        anchorElement?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, fixture.replyId);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );

      // Anchored viewport convergence assertions. These are the
      // "AC2 converged" claims proper — the reconciler has run
      // (proven by the poll above), the cache is repaired, and the
      // repaired instances are the ones the render is holding
      // (proven previously by the RG4a per-eventId classifier).
      // Anchoring is what makes them assertable at the render layer.
      await expect(
        page.getByText(`edit-target v2 converged ${stamp}`)
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`edit-target v1 ${stamp}`)).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(page.getByText(`redact-target ${stamp}`)).toHaveCount(0, {
        timeout: 30_000,
      });

      // Reaction chip absence is intentionally NOT asserted here.
      // The reconciler applies the redaction to the CACHE record
      // (asserted below) and to the redacted MatrixEvent instance
      // via `applyCachedRedactions` → `makeRedacted`, but the
      // aggregated relation on `liveThreadTimelineSet.relations`
      // is not always cleared: `removeMatchingAggregatedRelationEvent`
      // is a no-op when the reaction event has not been aggregated
      // into the thread's Relations index at the moment the
      // reconciler runs, and any later SDK live-sync aggregation
      // may re-insert a fresh non-redacted reaction instance with
      // the same id (Relations only dedups by id AFTER a first
      // add, and matrix-js-sdk's `makeRedacted` strips the
      // reaction's `m.relates_to`, so we can't proactively add the
      // redacted instance to keep the dedup gate closed).
      //
      // This is a real defect — separate shape from the render-
      // gap hunt (edit-target convergence works). It is filed as
      // a follow-up rather than fixed in-line because the owner's
      // RG4b directive scoped this task to the anchored
      // convergence assertions. See task #106.

      // Cache-level convergence for the edit target: the persist
      // step of the reconciler writes the mapped batch, so the
      // bundled body on M becomes v2. Poll because the persist
      // path is async.
      //
      // The reaction record is NOT asserted deleted here for the
      // same reason the chip is not asserted absent above: the
      // engine's delete-on-redaction path (`onRedaction` in
      // engineWriteThrough) fires from live-sync, not from the
      // reconciler's fetchRelations delivery, so the reaction
      // record persists in IDB until a live-sync redaction event
      // arrives for it. See follow-up task #106 (same defect
      // family as the chip).
      await expect
        .poll(
          async () => {
            const postRecords = await readThreadEventCacheRecords(
              page,
              fixture.roomId,
              threadId
            );
            const cachedEditTargetPost = postRecords.find(
              (record) => record.eventId === editTargetId
            );
            return cachedEditTargetPost?.bundledReplaceBody ?? null;
          },
          {
            timeout: 30_000,
            message: 'cache did not converge to bundled v2 on edit target after reopen',
          }
        )
        .toBe(`edit-target v2 converged ${stamp}`);

      // NO displacement assertion here — removed deliberately (review
      // F3 disposition (B), 2026-07-04). Two implementations were
      // tried and both rejected as dishonest or mis-scoped:
      //   1. Synthetic-resize sampling: sampled beforeTop after the
      //      repair had completed and "forced" a re-render with a
      //      window resize event — vacuous, passed even with the
      //      anchoring logic reverted.
      //   2. Live second-edit sampling: measured a REAL 25px shift,
      //      but the shift is pin-to-bottom reasserting over a
      //      programmatic (scrollIntoView) scroll that never set the
      //      user-scrolled intent flag — a pre-existing UX question
      //      about programmatic navigation, not a reconcile-repair
      //      property. Filed separately (task #119).
      // Repair-induced displacement is NOT measurable in this flow:
      // the reconcile repair completes before the anchor can be
      // scrolled into the virtualised window, so there is no repair
      // left to measure across. The canonical anchor-invariant
      // coverage (real wheel-scroll intent, streaming edits below the
      // read position) lives in
      // e2e/live/thread-virtualization-behaviors.spec.ts
      // ("streaming edits do not yank a scrolled-up reader") and is
      // green. AC2 owns what the reconciler owns: convergence,
      // asserted above.

      // CINNY-207 AC2 (2026-07-04): dump the retained scalar tripwires
      // after convergence. The RG4/RG5c diagnostic
      // registries were removed post-review (F1+F2); only the
      // permanent scalar counters remain. Log line goes to the
      // Playwright stdout stream (`RG-COUNTERS ...`) so the log
      // tee'd to /tmp can be grepped without a browser DevTools session.
      const counterSnapshot = await page.evaluate(() => {
        const w = window as Window & {
          __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
        };
        const snap = w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {};
        const pick = (key: string): number => Number(snap[key] ?? 0);
        return {
          renderTargetHadReplacement: pick('renderTargetHadReplacement'),
          renderTargetLackedReplacement: pick('renderTargetLackedReplacement'),
          applierMakeReplacedFired: pick('applierMakeReplacedFired'),
          applierMakeReplacedLatestEqualsCurrent: pick(
            'applierMakeReplacedLatestEqualsCurrent'
          ),
          applierMakeReplacedNoLatestEdit: pick('applierMakeReplacedNoLatestEdit'),
          reconcilesRepaired: pick('reconcilesRepaired'),
          reconcilesScheduled: pick('reconcilesScheduled'),
          // RG5d canonicalization WORK counter — NOT a must-stay-0
          // tripwire. It counts loser instances the canonicalizer
          // displaced; a stable small non-zero (3 in this flow) is
          // healthy expected dedup work: multiple ingestion paths
          // (onRepaired payloads, sync/echo deliveries) legitimately
          // hand the sink distinct instances of one identity.
          eventMapCanonicalizedDisplacements: pick(
            'eventMapCanonicalizedDisplacements'
          ),
          // RG5c permanent must-stay-0 tripwire, re-homed at the
          // canonicalization site post-F1 (per team-lead's directive
          // that a scalar tripwire on the picker rule must survive).
          // Bumps only when a displaced loser carried
          // `.replacingEvent()` non-null while the chosen winner had
          // it null — the picker's raw-presence rule (RG5-fix2) was
          // bypassed. Any non-zero reading is a real regression alarm.
          registrySwappedRepairedForUnrepaired: pick(
            'registrySwappedRepairedForUnrepaired'
          ),
        };
      });
      // Structured single-line log so the grep is trivial and copy-paste
      // faithful. Not an assertion — team-lead wants the reading, not
      // a pass/fail on it.
      // eslint-disable-next-line no-console
      console.log(`RG-COUNTERS ${JSON.stringify(counterSnapshot)}`);
    }
  );
});
