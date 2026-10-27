/**
 * Task #125 follow-up (2026-07-04): iOS WebKit kills flick momentum the
 * moment anything writes `scrollTop` programmatically. The thread
 * back-pagination pipeline prepends events and then restores the scroll
 * anchor with exactly such writes — and because the scroll-driven
 * trigger deliberately fires DURING the flick (prefetch headroom), the
 * prepend commit used to land mid-momentum and stop the scroll dead on
 * finger release. Downward scrolling never prepends, which is why it
 * kept its inertia.
 *
 * The original fix split pagination fetch from its render commit: data
 * is fetched while the flick is in flight, but the commit waits for the
 * scroller to be quiescent. Current thread/room prepends are compensated
 * through the offset ledger without a commit-time scroll write; this
 * waiter also gates the later exactly-cancelling ledger settlement, which
 * DOES write `scrollTop` and therefore must only run at true rest.
 * Quiescence means no scroll events (or wheels that can still start one)
 * for `idleMs`, no sampled `scrollTop` movement during that window, and no
 * active touch. Sampling matters on iOS because compositor momentum can
 * keep changing the offset while JavaScript scroll-event delivery pauses.
 * A clamped scroller (momentum slammed into the top edge) stops moving,
 * so the edge case resolves through the same idle path.
 *
 * `maxWaitMs` caps finite pagination waits so a pathological continuous
 * scroller still gets content instead of being starved. Ledger-settlement
 * consumers pass Infinity because their coherent margin can remain live
 * until genuine rest without delaying the fetched content itself.
 */

// The shared "quiet window" used by every scroll-quiescence consumer.
export const SCROLL_QUIESCENCE_IDLE_MS = 150;

// Touchless scroll sessions (iOS scroll-indicator scrubbing, trackpads)
// deliver no touch events and pause longer than any idle window while the
// compositor still owns the scroll position — the DOM offset freezes at
// the last delivered event, so neither the idle window nor the sampling
// check can see the live session. A settle write landing in such a pause
// is DISCARDED: both 2026-07-11 evening rides show folds up to +8,769px
// reverted to the exact pre-settle offset within 74-300ms
// (ride-trace-1783829722124 settles 491/617/650, pinned in
// rideTraceReplay.test.ts). Where the platform ships `scrollend` (WebKit
// since Safari/iOS 26.2) the session's end is observable directly: a
// scroll event marks the session live and only its scrollend releases the
// idle path. The stale TTL bounds a swallowed scrollend, so a wedged flag
// degrades to a late settle rather than a starved one; the ledger
// controller's discard watchdog remains the recovery on platforms
// without the event.
export const SCROLL_SESSION_STALE_MS = 1500;

// Detected per call: the check is one `in` lookup, and jsdom tests
// legitimately toggle the property to exercise both branches.
const supportsScrollEndEvents = (): boolean =>
  typeof window !== 'undefined' && 'onscrollend' in window;

export type WaitForScrollQuiescenceOptions = {
  // Quiet window with no scroll events (and no active touch) that
  // counts as quiescent.
  idleMs?: number;
  // Upper bound on the total wait; the promise always resolves. Pass
  // Infinity for a wait that ONLY resolves on genuine quiescence — a
  // forced resolve mid-motion is a scroll write mid-momentum for
  // consumers like the ledger settle. (Never pass huge finite values:
  // setTimeout clamps int32-overflowing delays to 0, turning the cap
  // into an immediate fire — a real bug the ios-momentum e2e caught.)
  maxWaitMs?: number;
};

// Window-level active-touch tracker (greptile P1 on PR #75): a wait
// that starts while a finger is ALREADY down would otherwise see no
// touchstart and no scroll events (drag-hold), and resolve mid-touch.
// The tracker observes touches from module load, so the initial
// touchActive state is correct regardless of call ordering. Listeners
// are passive and capture-phase (they must see touches that targets
// stopPropagation on).
let windowActiveTouches = 0;
let touchTrackerInstalled = false;
const installTouchTracker = () => {
  if (touchTrackerInstalled || typeof window === 'undefined') return;
  touchTrackerInstalled = true;
  // `touches` is read defensively: synthetic Events (tests, exotic
  // embedders) may lack it.
  const readActiveTouches = (event: Event): number => (event as TouchEvent).touches?.length ?? 0;
  window.addEventListener(
    'touchstart',
    (event) => {
      windowActiveTouches = Math.max(readActiveTouches(event), 1);
    },
    { passive: true, capture: true }
  );
  const onTouchSettle = (event: Event) => {
    windowActiveTouches = readActiveTouches(event);
  };
  window.addEventListener('touchend', onTouchSettle, { passive: true, capture: true });
  window.addEventListener('touchcancel', onTouchSettle, { passive: true, capture: true });
  // A swallowed touchend/touchcancel (target unmounted mid-gesture, tab
  // backgrounded during a touch, UA gesture-cancel racing listener
  // install) would wedge the counter above zero for the rest of the
  // session — and every Infinity-cap wait (the ledger settles) would
  // pend forever, rescued only by the boundary guard (adversarial
  // review 2026-07-07, periphery F1). No real touch survives a page
  // lifecycle transition, so those transitions re-zero the model.
  const onLifecycleReset = () => {
    windowActiveTouches = 0;
  };
  window.addEventListener('visibilitychange', onLifecycleReset, { capture: true });
  window.addEventListener('pagehide', onLifecycleReset, { capture: true });
};
installTouchTracker();

// Consulted by callers that need an instantaneous read of the global touch
// state (currently the measurement-correction hook on the timeline
// virtualizer, which cannot see virtual-core's private touch flags).
export const hasActiveWindowTouches = (): boolean => windowActiveTouches > 0;

// Mirrors @tanstack/virtual-core's unexported isIOSWebKit(): every iOS
// browser is WebKit (UA carries iPhone/iPod/iPad), and iPadOS desktop mode
// masquerades as MacIntel but exposes touch points.
let iosWebKitResult: boolean | undefined;
export const isIOSWebKitDevice = (): boolean => {
  if (iosWebKitResult !== undefined) return iosWebKitResult;
  if (typeof navigator === 'undefined') {
    iosWebKitResult = false;
    return iosWebKitResult;
  }
  if (/iP(hone|od|ad)/.test(navigator.userAgent)) {
    iosWebKitResult = true;
    return iosWebKitResult;
  }
  const maxTouchPoints = navigator.maxTouchPoints;
  iosWebKitResult =
    navigator.platform === 'MacIntel' && maxTouchPoints !== undefined && maxTouchPoints > 0;
  return iosWebKitResult;
};

export const waitForScrollQuiescence = (
  scrollElement: HTMLElement | null,
  { idleMs = SCROLL_QUIESCENCE_IDLE_MS, maxWaitMs = 2500 }: WaitForScrollQuiescenceOptions = {}
): Promise<void> => {
  // Detached elements can't scroll and their touchend may never fire —
  // resolve immediately (gemini on PR #75).
  if (!scrollElement || !scrollElement.isConnected) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let sampledScrollTop = scrollElement.scrollTop;
    // Scroll-session tracking (scrollend-capable platforms only): a wait
    // that observes a scroll event is inside a session until its scrollend
    // arrives or the session goes stale. A wait armed entirely within a
    // session's pause sees no event and keeps today's idle behavior — the
    // discard watchdog covers that residue.
    let scrollSessionLive = false;
    let lastScrollEventAt = 0;

    const cleanup = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (capTimer !== undefined) clearTimeout(capTimer);
      scrollElement.removeEventListener('scroll', onActivity);
      scrollElement.removeEventListener('scrollend', onScrollSessionEnd);
      scrollElement.removeEventListener('wheel', onWheel, true);
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    // Touch state has a SINGLE source of truth: the window-level
    // tracker (counts remaining touches, capture phase, observing from
    // module load). A per-wait element flag was removed after PR #75
    // review round 7 — any local boolean can wedge (stuck true blocks
    // until the cap; stuck false is covered by the tracker anyway),
    // and the tracker sees every touch the element would.
    const armIdleTimer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      sampledScrollTop = scrollElement.scrollTop;
      idleTimer = setTimeout(() => {
        // Element unmounted mid-wait: settle rather than ride out the
        // cap (gemini on PR #75).
        if (!scrollElement.isConnected) {
          settle();
          return;
        }
        const currentScrollTop = scrollElement.scrollTop;
        if (currentScrollTop !== sampledScrollTop) {
          // iOS may throttle JavaScript scroll events while compositor
          // momentum keeps advancing the native scroller. The offset is
          // a stable double at genuine rest, so compare it exactly: a
          // subpixel tolerance could misclassify slow residual momentum
          // as quiet and let the consumer's scrollTop write cancel it.
          sampledScrollTop = currentScrollTop;
          armIdleTimer();
          return;
        }
        const sessionStillLive =
          scrollSessionLive && Date.now() - lastScrollEventAt < SCROLL_SESSION_STALE_MS;
        if (windowActiveTouches === 0 && !sessionStillLive) {
          settle();
          return;
        }
        // A finger is still down, or a touchless scroll session has not
        // delivered its scrollend: re-arm and poll at idle granularity
        // (a touchend elsewhere has no element event to re-arm through;
        // the session flag times out via the stale TTL). Bounded by the
        // cap timer for finite waits.
        armIdleTimer();
      }, idleMs);
    };

    function onActivity() {
      if (supportsScrollEndEvents()) {
        scrollSessionLive = true;
        lastScrollEventAt = Date.now();
      }
      armIdleTimer();
    }

    function onScrollSessionEnd() {
      scrollSessionLive = false;
      armIdleTimer();
    }

    // A wheel starts a scroll whose first scroll event comes a frame or
    // more later (over a second after a heavy WebKit frame), and WebKit
    // cancels a wheel scroll that a scrollTop write lands on before it
    // moves. So a wheel counts as that scroll's first event, unless it
    // cannot move this scroller: sideways, into an edge (a reader pushing at
    // the top still gets the settle that reveals the rows folded in above),
    // a zoom (ctrl, pinch), or consumed by a scrollable descendant. The
    // bottom edge allows 1px: at fractional zoom the native maximum sits
    // just below scrollHeight - clientHeight.
    const canScroll = (element: Element, deltaY: number) =>
      deltaY < 0
        ? element.scrollTop > 0
        : deltaY > 0 && element.scrollTop < element.scrollHeight - element.clientHeight - 1;
    function onWheel(event: WheelEvent) {
      const scroller = event.currentTarget as Element;
      if (event.ctrlKey || !canScroll(scroller, event.deltaY)) return;
      for (let node = event.target as Element | null; node && node !== scroller; ) {
        const overflowY = canScroll(node, event.deltaY) && getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return;
        node = node.parentElement;
      }
      onActivity();
    }

    scrollElement.addEventListener('scroll', onActivity, { passive: true });
    scrollElement.addEventListener('wheel', onWheel, { passive: true, capture: true });
    // Harmless where unsupported: the event simply never fires, and the
    // session flag is only ever set on scrollend-capable platforms.
    scrollElement.addEventListener('scrollend', onScrollSessionEnd, { passive: true });

    if (Number.isFinite(maxWaitMs)) {
      capTimer = setTimeout(settle, maxWaitMs);
    }
    armIdleTimer();
  });
};
