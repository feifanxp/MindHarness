import { MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import {
  hasMindroomMessageExtras,
  parseMindroomMessageExtras,
} from '../messages/messageExtrasData';
import { getMindroomThreadSummaryInfo, hasMindroomThreadSummary } from '../messages/threadSummary';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit, reactionOrEditEvent } from '../../utils/room';
import { inSameDay } from '../../utils/time';
import { countCacheProbe } from './cacheProbe';

export type ThreadInitialRenderMode = 'loading' | 'cached' | 'live';
export type ThreadRenderEventEntry<TEvent extends MatrixEvent = MatrixEvent> = {
  event: TEvent;
  absoluteIndex: number;
};
type ThreadOpenBottomPinOpts = {
  suppressOpenBottomPin?: boolean;
  threadId?: string;
  threadLatestOpenPending: boolean;
  // Latched true once an open-at-latest began for this thread; survives
  // the open chain completing. Hydration bands can land long after the
  // chain (background prefetch/reconciler) — the pin must hold for them.
  threadOpenedAtLatest: boolean;
  // A real scroll gesture ends the pin permanently for this thread view:
  // from then on the reader owns the position.
  hasUserScrollIntent: boolean;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadEventCount: number;
};

export const getThreadInitialRenderMode = ({
  initializationComplete,
  availableEventCount,
}: {
  initializationComplete: boolean;
  availableEventCount: number;
}): ThreadInitialRenderMode => {
  if (initializationComplete) return 'live';
  return availableEventCount > 0 ? 'cached' : 'loading';
};

export const shouldPinThreadToBottomOnOpen = ({
  suppressOpenBottomPin,
  threadId,
  threadLatestOpenPending,
  threadOpenedAtLatest,
  hasUserScrollIntent,
  threadInitialRenderMode,
  threadEventCount,
}: ThreadOpenBottomPinOpts): boolean =>
  !!threadId &&
  !suppressOpenBottomPin &&
  (threadLatestOpenPending || (threadOpenedAtLatest && !hasUserScrollIntent)) &&
  threadInitialRenderMode !== 'loading' &&
  threadEventCount > 0;

type ThreadAutoPaginateBackOpts = {
  threadId?: string;
  // Index of the FIRST virtual row currently rendered (top of the
  // overscan window). undefined when nothing is rendered yet.
  firstRenderedIndex: number | undefined;
  // Single-flight: a back-pagination is already in progress.
  paginatingBack: boolean;
  // Same condition that shows the "Load Older Messages" chip — older
  // content exists in cache or on the server.
  showLoadOlder: boolean;
  // A real user scroll gesture (wheel/touch/keyboard) has happened in
  // this thread view. Auto-pagination is a RESPONSE to the user
  // scrolling toward the edge; without a gesture, a low rendered
  // index is an open-time artifact (the virtualizer transiently
  // renders from index 0 before the pin-to-bottom lands) and must not
  // fire. Deliberately NOT the open-lifecycle pending flag: that flag
  // stays true until the whole open-time backfill chain completes,
  // which on slow networks spans the entire loading phase — exactly
  // when a scrolling user needs the trigger live (task #125).
  hasUserScrollIntent: boolean;
  triggerRows: number;
};

// Scroll-driven thread back-pagination predicate (task #125). Pure so
// the trigger condition is unit-testable apart from the effect wiring.
// Fires when the rendered window's top edge is within `triggerRows` of
// the loaded content's start — early enough that the cache-first
// pagination pipeline (IDB read, then network fallback) completes
// before momentum scrolling reaches the edge. Re-firing after a
// completed pagination is naturally throttled: the prepend anchor
// restore pushes firstRenderedIndex back up by the prepended count, so
// the predicate only becomes true again when the user scrolls further
// up (or the remaining history is shorter than the headroom, in which
// case it drains the tail — bounded by showLoadOlder flipping false).
export const shouldAutoPaginateThreadBack = ({
  threadId,
  firstRenderedIndex,
  paginatingBack,
  showLoadOlder,
  hasUserScrollIntent,
  triggerRows,
}: ThreadAutoPaginateBackOpts): boolean =>
  !!threadId &&
  !paginatingBack &&
  hasUserScrollIntent &&
  showLoadOlder &&
  firstRenderedIndex !== undefined &&
  firstRenderedIndex <= triggerRows;

type MeasurementScrollCorrectionOpts = {
  // item.end <= scrollOffset: only a row ENTIRELY above the viewport needs
  // a compensating scrollTop write (its growth would silently shift what
  // the user is reading). virtual-core's default uses item.start instead,
  // which also compensates rows STRADDLING the viewport top — but those are
  // visible: a user expanding/collapsing an on-screen tool-call block must
  // see the content unfold in place, not have the view scrolled by the
  // block's size delta (device report 2026-07-06).
  itemFullyAboveViewport: boolean;
  isIOSWebKitDevice: boolean;
  isScrollingBackward: boolean;
};

// Decides virtual-core's shouldAdjustScrollPositionOnItemSizeChange for the
// timeline virtualizer. On iOS WebKit, above-viewport corrections NEVER
// write scrollTop: they are dropped into the offset ledger (container
// margin + scrollMargin in lockstep, paired with the tile reposition in
// ONE commit), which cancels them without a write. Mid-scroll writes kill
// momentum, and even quiet-state applies proved unsafe — virtual-core's
// internal adjustment bursts can clamp at the top edge (a scrollTo(-44)
// the prepend one-paint e2e photographed), under-applying silently, and
// per-call clamp prediction is impossible from the hook (the instance's
// scrollOffset is stale during a burst). The ledger settles in one
// exactly-cancelling write at true rest.
//
// Desktop backward scrolling uses the same ledger. A remembered expanded
// message can remount thousands of pixels taller than its collapsed cached
// size; applying that correction directly reverses the upward ride, moves the
// measured row back out of the window, and lets the following shrink clamp the
// reader to the bottom. Forward/quiet desktop corrections stay immediate.
export const shouldApplyMeasurementScrollCorrection = ({
  itemFullyAboveViewport,
  isIOSWebKitDevice: isIOS,
  isScrollingBackward,
}: MeasurementScrollCorrectionOpts): boolean =>
  itemFullyAboveViewport && !isIOS && !isScrollingBackward;

type MeasurementScrollCorrectionHookDeps = {
  shouldDeferAutomaticFillCorrection?: (item: { index?: number }) => boolean;
  // Read lazily per correction: iOS detection is cached module state.
  isIOSWebKitDevice: () => boolean;
  // The delta is folded into the offset ledger to preserve the owned
  // anchor: normally the viewport, or the latest event during room fill.
  onDroppedCorrection: (deltaPx: number) => void;
  // The virtual-core offset at the top of the reader's view for a scroll
  // offset, when sticky headers and content above the list (a thread's
  // banner and Load Older) set them apart.
  viewportTopOffset?: (scrollOffset: number) => number | undefined;
  // virtual-core writes an applied correction at once, but reports rows where
  // they were when React last rendered them: the caller sums the corrections
  // applied since then and renders them before the browser paints.
  onAppliedCorrection?: (deltaPx: number) => void;
  unrenderedCorrectionPx?: () => number;
};

// virtual-core takes a scroll event within this of its own last write as
// that write (a zoomed page rounds fractional offsets).
const VIRTUAL_CORE_WRITE_TOLERANCE_PX = 1.5;

// Builds the exact shouldAdjustScrollPositionOnItemSizeChange closure the
// timeline installs on its virtualizer instance. Extracted so the iOS
// scroll contract test (virtualizerIOSScrollContract.test.ts) exercises the
// production closure against the real, unmocked virtual-core — not a
// re-implementation that could drift.
export const buildMeasurementScrollCorrectionHook =
  ({
    isIOSWebKitDevice,
    onDroppedCorrection,
    shouldDeferAutomaticFillCorrection,
    viewportTopOffset,
    onAppliedCorrection,
    unrenderedCorrectionPx,
  }: MeasurementScrollCorrectionHookDeps) =>
  (
    item: { end: number; index?: number },
    delta: number,
    instance: {
      scrollOffset: number | null;
      scrollDirection: 'forward' | 'backward' | null;
      scrollElement?: { scrollTop: number } | null;
    }
  ): boolean => {
    // A programmatic scroll writes the element before its scroll event
    // updates virtual-core's cached offset. Judge this resize against the
    // live offset, and make virtual-core apply any adjustment from it: its
    // applyScrollAdjustment (3.17.3) writes scrollOffset + its pending
    // adjustments, so fold the difference into those (the iOS contract test
    // pins this). scrollOffset stays as it is, or virtual-core would ignore
    // the scroll event as already seen and lose its direction and reset.
    // An upward write it has not seen yet is a backward scroll: applying a
    // correction now would fold that move away before its event.
    const cachedOffset = instance.scrollOffset ?? 0;
    const liveOffset = instance.scrollElement?.scrollTop;
    if (typeof liveOffset === 'number') {
      (instance as unknown as { scrollAdjustments: number }).scrollAdjustments =
        liveOffset - cachedOffset;
    }
    const scrollOffset = liveOffset ?? cachedOffset;
    // Judge the row in the rendered layout, where the reader has not moved yet.
    const renderedOffset = scrollOffset - (unrenderedCorrectionPx?.() ?? 0);
    const itemFullyAboveViewport =
      item.end <= (viewportTopOffset?.(renderedOffset) ?? renderedOffset);
    const automaticFillPredecessor = shouldDeferAutomaticFillCorrection?.(item) ?? false;
    // Scrolling cannot go above the top: the browser would clamp the write and
    // lose the correction, so the ledger takes it instead.
    const apply =
      !automaticFillPredecessor &&
      scrollOffset + delta >= 0 &&
      shouldApplyMeasurementScrollCorrection({
        itemFullyAboveViewport,
        isIOSWebKitDevice: isIOSWebKitDevice(),
        isScrollingBackward:
          instance.scrollDirection === 'backward' ||
          scrollOffset < cachedOffset - VIRTUAL_CORE_WRITE_TOLERANCE_PX,
      });
    // During latest-open fill, visible predecessors also move the retained
    // latest anchor. Its own height cannot move its start and is excluded by
    // the owner. Ordinary visible rows keep their natural reflow policy.
    if (!apply && (itemFullyAboveViewport || automaticFillPredecessor)) {
      onDroppedCorrection(delta);
    }
    if (apply) onAppliedCorrection?.(delta);
    return apply;
  };

type LedgerBoundaryOpts = {
  // Accumulated offset-ledger pixels (Σ dropped correction deltas;
  // container marginTop is -px).
  ledgerPx: number;
  // Client-coordinate tops/bottoms of the inner virtual container and
  // the scroll element.
  innerTop: number;
  innerBottom: number;
  scrollTop: number;
  scrollBottom: number;
  // Native element scroll offset, distinct from scrollTop above (the
  // viewport rect's client coordinate).
  scrollOffset: number;
  clientHeight: number;
  // Scroller content height; with clientHeight it bounds the physical
  // scroll range so rubber-band overscroll can be recognized.
  scrollHeight: number;
  // TanStack convention: forward increases scrollTop (toward the bottom),
  // backward decreases it (toward the top). A stationary scroll event is
  // left unknown and ordinary quiescence owns the eventual settlement.
  scrollDirection: 'forward' | 'backward' | null;
};

// Ledger boundary predicate. Negative ledger creates real blank space at
// the top, so settle within two viewports while travelling toward it.
// Positive ledger instead pulls the box upward: there is no top blank, and
// the remaining physical scroll range is valid runway. Paying it early
// kills iOS momentum (ride-trace-1783784177182 settled +89px while native
// motion was still about -56px/frame), so wait for actual top exhaustion.
// Positive ledger can still expose/clamp the bottom and keeps its proactive
// toward-bottom guard. Once either edge is actually crossed, settle without
// a direction gate; stationary/away proximity waits for ordinary rest.
export const shouldSettleLedgerAtBoundary = ({
  ledgerPx,
  innerTop,
  innerBottom,
  scrollTop,
  scrollBottom,
  scrollOffset,
  clientHeight,
  scrollHeight,
  scrollDirection,
}: LedgerBoundaryOpts): boolean => {
  if (ledgerPx > -48 && ledgerPx < 48) return false;
  // Rubber-band deferral: outside the physical range (iOS overscroll) a
  // settle rewrites scrollTop mid-bounce and lands as a visible snap
  // (ride-trace-1783802452438 frame 192: an 87px slip written 87px past
  // the bottom edge during bounce-back). The bounce background hides the
  // ledger blank either way, and the bounce's landing event re-enters
  // bounds — where this guard resumes — while a true rest is settled with
  // zero slip by the quiescence path. 1px slack absorbs fractional
  // iOS offsets around the exact edges.
  const maxScrollOffset = Math.max(0, scrollHeight - clientHeight);
  if (scrollOffset < -1 || scrollOffset > maxScrollOffset + 1) return false;
  const guardPx = clientHeight * 2;
  const reachableContentTop = innerTop + Math.max(ledgerPx, 0);
  if (ledgerPx < 0) {
    if (reachableContentTop >= scrollTop) return true;
    if (scrollDirection === 'backward' && reachableContentTop > scrollTop - guardPx) return true;
  }
  if (ledgerPx > 0) {
    // Use the element's physical offset, not the inner rect: parent
    // padding or loading controls can put reachableContentTop at/inside
    // the viewport before Safari has exhausted its native runway.
    if (scrollOffset <= 0) return true;
    if (innerBottom <= scrollBottom) return true;
    if (scrollDirection === 'forward') return innerBottom < scrollBottom + guardPx;
  }
  return false;
};

// Discarded settle writes (PR #126, second mechanism). During a touchless
// scroll session — iOS scroll-indicator scrubbing or a trackpad: no touch
// events, event-delivery pauses longer than any idle window — the
// compositor still owns the scroll position. A settle write landing in
// such a pause is discarded wholesale: the next compositor commit
// reasserts the pre-settle offset as one large scroll event against the
// fold, 74-300ms later on the recorded rides (ride-trace-1783829722124
// settles 491/617/650, ride-trace-1783829767914 settles 1612/1631 — the
// 491/617 folds were snapshot-coherent and landed atomically, so the
// split-settle preflight cannot see this class). The predicate recognizes
// the reassertion event so the controller can restore the fold to the
// ledger; thresholds are census-calibrated against all 49 large settles
// in the trace corpus: 7 discards, 0 false positives
// (rideTraceReplay.test.ts).
export const SETTLE_DISCARD_WINDOW_MS = 2000;
// Watches arm only for folds the boundary guard considers meaningful; a
// discarded sub-48px fold is visually indistinct from sampling noise.
export const SETTLE_DISCARD_MIN_LEDGER_PX = 48;
// An event this close to the settled offset is the write's own echo (or
// rest); one beyond it that is NOT a reassertion means motion resumed
// from the settled position — the write held, stop watching.
export const SETTLE_DISCARD_HELD_SLACK_PX = 24;
// The reassertion arrives as a single event restoring essentially the
// WHOLE fold (all seven corpus reversions measure 0.99-1.04x of px: the
// compositor returns to its own track wholesale). Genuine momentum
// resuming after a HELD write steps much smaller relative to the fold —
// the #119 device sequence settles 72px and then moves 49px (0.68x),
// which a 0.6 ratio misread as a reversion.
const SETTLE_DISCARD_DELTA_RATIO = 0.8;
// ...and it lands near the pre-settle offset (the compositor kept
// scrubbing during the ping-pong on one ride: 180px past the exact
// value at a 512px fold, hence proportional rather than exact slack).
const SETTLE_DISCARD_PROXIMITY_RATIO = 0.5;
const SETTLE_DISCARD_PROXIMITY_MIN_PX = 48;

type DiscardedSettleWriteOpts = {
  // Ledger pixels the settle folded (its write was scrollTop += px).
  px: number;
  // scrollTop immediately before the settle write.
  preSettleScrollTop: number;
  // Offset of the previous scroll event (the settle's clamped read-back
  // seeds the baseline, so the first event's delta is measured from the
  // settled offset).
  previousScrollTop: number;
  // Offset of the scroll event under classification.
  currentScrollTop: number;
};

export const isDiscardedSettleWrite = ({
  px,
  preSettleScrollTop,
  previousScrollTop,
  currentScrollTop,
}: DiscardedSettleWriteOpts): boolean => {
  const delta = currentScrollTop - previousScrollTop;
  const againstFold = px > 0 ? delta < 0 : delta > 0;
  if (!againstFold) return false;
  if (Math.abs(delta) < SETTLE_DISCARD_DELTA_RATIO * Math.abs(px)) return false;
  return (
    Math.abs(currentScrollTop - preSettleScrollTop) <=
    Math.max(SETTLE_DISCARD_PROXIMITY_MIN_PX, SETTLE_DISCARD_PROXIMITY_RATIO * Math.abs(px))
  );
};

// Estimate from each message's content rather than a shared average: short
// messages and folded long messages have substantially different heights.
// The base and line sizes were calibrated against measured virtualizer tiles;
// the fold budget tracks CollapsibleMessage's preview with an overlaid control.
// Tile rectangles exclude inter-row margins, as does the virtualizer cache.
const THREAD_ROW_BASE_PX = 10;
const THREAD_ROW_BASE_COMPACT_PX = 6;
const THREAD_ROW_LINE_PX = 20;
// CollapsibleMessage previews 11em; its collapsed control adds no row height.
const THREAD_ROW_FOLD_CONTENT_LINES = 9;
const THREAD_ROW_WRAP_CHARS_PER_LINE = 48;
// Always-expanded rows render their whole body; the estimate is line-based
// and bounded (a pathological body should not produce a megapixel row).
const THREAD_ROW_MAX_ESTIMATED_LINES = 48;
const THREAD_ROW_BODY_SCAN_CHARS = 4096;
// Extras sections render as collapsed accordion headers.
const THREAD_ROW_SECTION_HEADER_PX = 40;

const estimateBodyLines = (body: string): number => {
  const scanned =
    body.length > THREAD_ROW_BODY_SCAN_CHARS ? body.slice(0, THREAD_ROW_BODY_SCAN_CHARS) : body;
  // Wrap is counted PER PHYSICAL LINE: the previous newlines-plus-
  // global-length formula double-counted every wrapped line's newline
  // (part of the systematic over-estimate the calibration removed).
  let lines = 0;
  let lineStart = 0;
  for (let i = 0; i <= scanned.length; i += 1) {
    if (i === scanned.length || scanned.charCodeAt(i) === 10) {
      const lineLength = i - lineStart;
      lines += Math.max(1, Math.ceil(lineLength / THREAD_ROW_WRAP_CHARS_PER_LINE));
      lineStart = i + 1;
      if (lines >= THREAD_ROW_MAX_ESTIMATED_LINES) return THREAD_ROW_MAX_ESTIMATED_LINES;
    }
  }
  if (body.length > scanned.length) return THREAD_ROW_MAX_ESTIMATED_LINES;
  return Math.min(lines, THREAD_ROW_MAX_ESTIMATED_LINES);
};

export const estimateThreadEventRowHeight = (
  mEvent: MatrixEvent,
  { compact }: { compact: boolean }
): number => {
  const base = compact ? THREAD_ROW_BASE_COMPACT_PX : THREAD_ROW_BASE_PX;
  const relationType = mEvent.getRelation()?.rel_type;
  // Edits and reactions have no tile to measure. Reserve exactly zero
  // space so a streaming history cannot accumulate phantom scroll height.
  if (relationType === RelationType.Replace || relationType === RelationType.Annotation) {
    return 0;
  }
  const content = mEvent.getContent();
  const contentRecord = content as Record<string, unknown>;
  const body = typeof content.body === 'string' ? content.body : '';
  // Thread rows render a summary as a one-line marker under the reply before it.
  if (getMindroomThreadSummaryInfo(contentRecord)?.summaryText) return base + THREAD_ROW_LINE_PX;
  // Always-expanded rows (agent tool traces / legacy thread summaries) never
  // fold: the body renders in full and each extras section adds a
  // collapsed accordion header. Estimating these at the fold cap made
  // every one of them mount ~hundreds of px small — the per-frame jumps
  // the ride-smoothness e2e budget now pins.
  if (hasMindroomThreadSummary(contentRecord) || hasMindroomMessageExtras(contentRecord)) {
    const sections = parseMindroomMessageExtras(contentRecord)?.sections.length ?? 0;
    return (
      base + estimateBodyLines(body) * THREAD_ROW_LINE_PX + sections * THREAD_ROW_SECTION_HEADER_PX
    );
  }
  const lines = estimateBodyLines(body);
  if (lines > THREAD_ROW_FOLD_CONTENT_LINES) {
    return base + THREAD_ROW_FOLD_CONTENT_LINES * THREAD_ROW_LINE_PX;
  }
  return base + lines * THREAD_ROW_LINE_PX;
};

/**
 * MSC3440: a thread reply carrying `is_falling_back: true` only includes
 * `m.in_reply_to` as a fallback for thread-unaware clients; thread-aware
 * rendering must not treat it as a real reply. Read from wire content —
 * the same source `MatrixEvent.replyEventId` uses.
 */
export const isThreadFallbackReply = (mEvent: MatrixEvent): boolean => {
  const relatesTo = mEvent.getWireContent()?.['m.relates_to'] as
    | { rel_type?: string; is_falling_back?: boolean }
    | undefined;
  return relatesTo?.rel_type === RelationType.Thread && relatesTo.is_falling_back === true;
};

export const isThreadOnlyRoomActivity = (room: Room, mEvt: MatrixEvent): boolean => {
  const mEventId = mEvt.getId();
  const relationTargetId = mEvt.getRelation()?.event_id;
  const relatedEvent = relationTargetId ? room.findEventById(relationTargetId) : undefined;
  const relatedEventId = relatedEvent?.getId();
  const isThreadReplyMessage = !!mEventId && !!mEvt.threadRootId && mEvt.threadRootId !== mEventId;
  const isThreadReplyRelatedEvent =
    !!relatedEventId &&
    !!relatedEvent?.threadRootId &&
    relatedEvent.threadRootId !== relatedEventId;
  return isThreadReplyMessage || isThreadReplyRelatedEvent;
};

export const buildResolveConfirmedEventId = (
  room: Room,
  events?: MatrixEvent[]
): ((txnId: string) => string | undefined) => {
  let fallbackMap: Map<string, string> | undefined;
  const getFallbackMap = (): Map<string, string> => {
    if (!fallbackMap) {
      fallbackMap = new Map();
      if (events) {
        for (const mEvent of events) {
          const txnId = mEvent.getTxnId?.() ?? mEvent.getUnsigned()?.transaction_id;
          const eventId = mEvent.getId();
          if (
            typeof txnId === 'string' &&
            txnId.length > 0 &&
            typeof eventId === 'string' &&
            !eventId.startsWith('~')
          ) {
            fallbackMap.set(txnId, eventId);
          }
        }
      }
    }
    return fallbackMap;
  };

  return (txnId: string): string | undefined => {
    const event = room.getEventForTxnId?.(txnId);
    if (event) {
      const confirmedId = event.getId();
      if (typeof confirmedId === 'string' && !confirmedId.startsWith('~')) {
        return confirmedId;
      }
    }
    return getFallbackMap().get(txnId);
  };
};

const getThreadRenderEventId = (mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  return typeof eventId === 'string' && eventId.length > 0 ? eventId : undefined;
};

const getThreadRenderTransactionId = (mEvent: MatrixEvent): string | undefined => {
  const txnId = mEvent.getTxnId?.() ?? mEvent.getUnsigned()?.transaction_id;
  return typeof txnId === 'string' && txnId.length > 0 ? txnId : undefined;
};

const getThreadRenderEventKeys = (
  mEvent: MatrixEvent,
  resolveConfirmedId?: (txnId: string) => string | undefined
): string[] => {
  const keys: string[] = [];

  const eventId = getThreadRenderEventId(mEvent);
  if (eventId) keys.push(`event:${eventId}`);

  const txnId = getThreadRenderTransactionId(mEvent);
  if (txnId) {
    keys.push(`txn:${txnId}`);

    if (resolveConfirmedId && isLocalEchoEvent(mEvent)) {
      const confirmedId = resolveConfirmedId(txnId);
      if (confirmedId && confirmedId !== eventId) {
        keys.push(`event:${confirmedId}`);
      }
    }
  }

  return keys;
};

export const getThreadRenderEventKey = (mEvent: MatrixEvent): string | undefined =>
  getThreadRenderEventKeys(mEvent)[0];

const isLocalEchoEvent = (mEvent: MatrixEvent): boolean => {
  const eventId = getThreadRenderEventId(mEvent);
  if (eventId?.startsWith('~')) return true;
  return mEvent.isSending();
};

const getEffectiveReplacementEvent = (mEvent: MatrixEvent): MatrixEvent | undefined => {
  const replacingEvent = mEvent.replacingEvent() ?? undefined;
  const serializedReplacement = getSerializedReplacementEvent(mEvent);

  return getLatestEdit(
    mEvent,
    [replacingEvent, serializedReplacement].filter((editEvent): editEvent is MatrixEvent =>
      isSameSenderEditEvent(mEvent, editEvent)
    )
  );
};

export const pickPreferredThreadRenderEvent = (
  existingEvent: MatrixEvent,
  incomingEvent: MatrixEvent,
  resolveConfirmedId?: (txnId: string) => string | undefined
): MatrixEvent => {
  if (existingEvent === incomingEvent) return existingEvent;

  const existingKeys = new Set(getThreadRenderEventKeys(existingEvent, resolveConfirmedId));
  const incomingKeys = getThreadRenderEventKeys(incomingEvent, resolveConfirmedId);
  if (incomingKeys.some((key) => existingKeys.has(key))) {
    const existingLocalEcho = isLocalEchoEvent(existingEvent);
    const incomingLocalEcho = isLocalEchoEvent(incomingEvent);
    if (existingLocalEcho !== incomingLocalEcho) {
      return existingLocalEcho ? incomingEvent : existingEvent;
    }
  }

  if (existingEvent.isRedacted() && !incomingEvent.isRedacted()) return existingEvent;
  if (!existingEvent.isRedacted() && incomingEvent.isRedacted()) return incomingEvent;

  const existingReplacement = getEffectiveReplacementEvent(existingEvent);
  const incomingReplacement = getEffectiveReplacementEvent(incomingEvent);
  if (existingReplacement || incomingReplacement) {
    const preferredReplacement = getLatestEdit(
      existingEvent,
      [existingReplacement, incomingReplacement].filter(
        (replacement): replacement is MatrixEvent => !!replacement
      )
    );
    if (
      preferredReplacement === existingReplacement &&
      preferredReplacement !== incomingReplacement
    ) {
      return existingEvent;
    }
    if (
      preferredReplacement === incomingReplacement &&
      preferredReplacement !== existingReplacement
    ) {
      return incomingEvent;
    }
  }

  // CINNY-207 AC2 render-gap RG5-fix2 (2026-07-04): structural monotonic
  // preference on the RAW `.replacingEvent()` field, consulted AFTER
  // the effective-replacement block above so it does not disturb the
  // D12-style ts→event_id ordering that block enforces when both sides
  // have an effective replacement. Encodes "repaired state is monotonic
  // within a thread-open" — a non-repaired same-id instance cannot
  // displace a repaired one, whether the repair is same-sender-visible
  // (handled by the effective block) or raw-only (handled here).
  //
  // Threat this closes: `handleThreadNewReply` fires AFTER a reconcile
  // repair with the SYNC-delivered instance for the same target id;
  // that instance lacks any replacement. If the repaired instance's
  // `.replacingEvent()` returns non-null but
  // `getEffectiveReplacementEvent` drops it (e.g. `isSameSenderEditEvent`
  // filter fails on a foreign-sender edit, or the raw replacement is
  // one the helper rejects on shape), the block above cannot fire and
  // the picker previously fell through to `return incomingEvent` —
  // silently wiping the repair through a different door than the one
  // RG5's onRepaired hydrated-view fix closed.
  //
  // Symmetric asymmetric check: if exactly one side has ANY raw
  // replacement while the other has none, prefer the one that does.
  // If both have raw replacements the effective helper rejected, we
  // fall through to the final incoming-wins tie-break — both sides
  // are equally "questionable" by the helper's rules; picking either
  // is defensible and matches pre-fix behavior for this shape.
  //
  // One rule, two seams: this picker is used by both `mergeThreadRenderEvents`
  // (sink merge post-`setSupplementalThreadEvents`) and — transitively —
  // by `buildThreadEvents`' final merge that combines SDK
  // `thread.events` and fallback state. The same monotonicity rule
  // therefore holds at both seams without duplicating logic.
  const existingHasRawReplacement = !!existingEvent.replacingEvent();
  const incomingHasRawReplacement = !!incomingEvent.replacingEvent();
  if (existingHasRawReplacement && !incomingHasRawReplacement) return existingEvent;
  if (!existingHasRawReplacement && incomingHasRawReplacement) return incomingEvent;

  return incomingEvent;
};

/** Thread rows render oldest first; equal timestamps fall back to event ID. */
export const compareThreadRenderOrder = (a: MatrixEvent, b: MatrixEvent): number =>
  a.getTs() - b.getTs() || (a.getId() ?? '').localeCompare(b.getId() ?? '');

export const mergeThreadRenderEvents = (
  existingEvents: MatrixEvent[],
  incomingEvents: MatrixEvent[],
  resolveConfirmedId?: (txnId: string) => string | undefined
): MatrixEvent[] => {
  const eventMap = new Map<string, MatrixEvent>();
  // Reverse index: every key an instance currently holds in `eventMap`.
  // Maintained on every write so loser-key reclamation is O(keys) per
  // loser instead of a full-map scan (PR #73 review). The index tracks
  // HELD keys explicitly, so it stays correct even when an instance's
  // derivable keys change under it (local echoes mutate their event id
  // in place on confirmation). Both maps are function-local and die
  // with this call — no retention hazard.
  const keysByInstance = new Map<MatrixEvent, Set<string>>();

  const indexedSet = (key: string, mEvent: MatrixEvent) => {
    const previous = eventMap.get(key);
    if (previous === mEvent) return;
    if (previous) keysByInstance.get(previous)?.delete(key);
    eventMap.set(key, mEvent);
    let heldKeys = keysByInstance.get(mEvent);
    if (!heldKeys) {
      heldKeys = new Set<string>();
      keysByInstance.set(mEvent, heldKeys);
    }
    heldKeys.add(key);
  };

  // CINNY-207 AC2 render-gap RG5d (2026-07-04): canonicalize on write.
  //
  // The prior `setEventForKeys` was a plain multi-set: it wrote the new
  // event under each of its keys without touching entries for other keys
  // any conflicting instance already held. That left orphan entries when
  // two instances of the same event identity arrived with only partially
  // overlapping key sets (e.g. a bare-txnId sending echo alongside an
  // eventId-only confirmed instance whose key sets happen not to overlap
  // because the SDK dropped the txnId from the confirmed instance's
  // unsigned payload). `Array.from(new Set(eventMap.values()))` at the
  // tail would then contain both instances — one identity, two
  // MatrixEvent references — and every downstream consumer (the applier,
  // the fallback-instance registry, `mergedById` diagnostics, and any
  // other reader iterating values) inherited the same hazard.
  //
  // The fix is a map invariant, not a post-pass rescue: any write for a
  // key set collects EVERY existing instance reachable through ANY key
  // (both the incoming keys and every key each conflict currently
  // occupies in the map), picks a single winner via
  // `pickPreferredThreadRenderEvent` (chained across 3+ conflicts), and
  // installs the winner under the full union of keys after fully
  // deleting each loser's entries. Post-canonicalization the map
  // invariant is: for any two keys K1, K2 that share an event identity,
  // `eventMap.get(K1) === eventMap.get(K2)`. `values()` therefore
  // contains one entry per identity, always.
  //
  // Observability: `eventMapCanonicalizedDisplacements` bumps once per
  // losing instance the canonicalizer had to displace. It is a WORK
  // counter, not a must-stay-0 tripwire — multiple ingestion paths
  // legitimately deliver distinct instances of one identity
  // (onRepaired payloads, sync/echo deliveries), so a stable small
  // non-zero reading is healthy dedup work (3 per AC2 live run). A
  // step-change in the reading names a new duplication source. See
  // cacheProbe.ts for the interpretation block.
  // A key collision only implies the SAME event identity when the two
  // instances can actually be the same event: equal event ids, a
  // missing id on either side (txn key is the only identity), or a
  // local echo awaiting its confirmed id. Two CONFIRMED events with
  // different real ids that happen to share a `txn:` key (server
  // misbehavior or cross-device coincidence) are distinct events —
  // treating them as one identity would silently drop a real thread
  // message from the render (greptile P2 on PR #73).
  const isSameEventIdentity = (a: MatrixEvent, b: MatrixEvent): boolean => {
    const aId = getThreadRenderEventId(a);
    const bId = getThreadRenderEventId(b);
    if (!aId || !bId) return true;
    if (aId === bId) return true;
    const aEcho = isLocalEchoEvent(a);
    const bEcho = isLocalEchoEvent(b);
    if (!aEcho && !bEcho) return false;
    if (aEcho && bEcho) {
      // Two echoes with different provisional ids sharing a txn key:
      // duplicate sends of one transaction — same identity.
      return true;
    }
    // Echo-vs-confirmed across a shared txn key is the confirmation
    // bridge ONLY when the echo's resolved confirmed id matches the
    // confirmed side (or is not yet known — a same-txn confirmed
    // arrival is then the confirmation by definition). If the echo
    // already resolves to a DIFFERENT confirmed id, the pair are two
    // distinct events that merely share a txn key (greptile P1 on
    // PR #73) and must not collapse.
    const echo = aEcho ? a : b;
    const confirmedSideId = aEcho ? bId : aId;
    const txnId = getThreadRenderTransactionId(echo);
    const resolvedId = txnId ? resolveConfirmedId?.(txnId) : undefined;
    return resolvedId === undefined || resolvedId === confirmedSideId;
  };

  const setEventForKeys = (keys: string[], mEvent: MatrixEvent) => {
    if (keys.length === 0) return;

    // Collect every distinct existing instance the incoming write
    // conflicts with via any of its keys — but only same-identity
    // instances participate in displacement. A distinct-identity
    // instance sharing a key keeps its other entries; the contested
    // key goes to the incoming write (plain last-write semantics for
    // cross-identity key collisions).
    const conflicts = new Set<MatrixEvent>();
    keys.forEach((key) => {
      const existing = eventMap.get(key);
      if (existing && existing !== mEvent && isSameEventIdentity(existing, mEvent)) {
        conflicts.add(existing);
      }
    });

    if (conflicts.size === 0) {
      // Fast path — no conflict. Plain multi-set.
      keys.forEach((key) => indexedSet(key, mEvent));
      return;
    }

    // Reduce (conflicts + incoming) through the picker to a single
    // winner. The picker's contract is `(existing, incoming)` with
    // incoming winning ties. To preserve the pre-canonicalization
    // semantics ("last write with the same key wins ties"), fold with
    // the conflict as the `existing` argument and the winner-so-far as
    // the `incoming` argument — so the final incoming `mEvent` retains
    // tie-break priority over prior conflicts, matching the prior
    // `existingEvents → incomingEvents` iteration order. The fold is
    // order-SENSITIVE but fully deterministic: `conflicts` is a Set,
    // and Set iteration is insertion order, which is the caller's key
    // order — the same inputs always produce the same winner.
    // (>1 same-identity conflict additionally requires a key set that
    // bridges two previously-separate entries, which the identity
    // check above bounds to local-echo confirmation shapes.)
    let winner = mEvent;
    conflicts.forEach((conflict) => {
      winner = pickPreferredThreadRenderEvent(conflict, winner, resolveConfirmedId);
    });

    // Every non-winner instance among (conflicts ∪ {mEvent}) is a
    // loser and must be fully displaced.
    const losers = new Set<MatrixEvent>();
    conflicts.forEach((c) => {
      if (c !== winner) losers.add(c);
    });
    if (winner !== mEvent) losers.add(mEvent);

    // Reclaim every key any loser currently occupies BEFORE deleting,
    // so the winner inherits them. The reverse index gives the HELD
    // key set per loser directly — a loser's current map keys are not
    // derivable from the instance (local echoes mutate their event id
    // in place on confirmation, stranding entries under keys
    // `getThreadRenderEventKeys` no longer returns), which is why the
    // index tracks writes rather than recomputing keys.
    const unionKeys = new Set<string>(keys);
    getThreadRenderEventKeys(winner, resolveConfirmedId).forEach((k) => unionKeys.add(k));
    if (losers.size > 0) {
      losers.forEach((loser) => {
        keysByInstance.get(loser)?.forEach((key) => {
          unionKeys.add(key);
          eventMap.delete(key);
        });
        keysByInstance.delete(loser);
      });
      losers.forEach(() => countCacheProbe('eventMapCanonicalizedDisplacements'));
      // CINNY-207 AC2 render-gap RG5c (re-homed post-F1): permanent
      // must-stay-0 tripwire on the picker rule. Bumps if any loser
      // carried `.replacingEvent()` non-null while the chosen winner
      // has `.replacingEvent()` null — the "repaired state is
      // monotonic across a same-id tie" preference
      // (`pickPreferredThreadRenderEvent`'s RG5-fix2 raw-presence
      // rule) is violated at the map layer. The picker's contract
      // makes this shape unreachable in the current tree; any
      // non-zero reading names a real regression.
      if (winner.replacingEvent() == null) {
        let anyLoserRepaired = false;
        losers.forEach((loser) => {
          if (!anyLoserRepaired && loser.replacingEvent() != null) {
            anyLoserRepaired = true;
          }
        });
        if (anyLoserRepaired) {
          countCacheProbe('registrySwappedRepairedForUnrepaired');
        }
      }
    }

    unionKeys.forEach((key) => indexedSet(key, winner));
  };

  existingEvents.forEach((mEvent) => {
    const keys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (keys.length === 0) return;
    setEventForKeys(keys, mEvent);
  });

  // CINNY-207 AC2 render-gap RG1 (2026-07-04) — F9 fold (2026-07-04):
  // observability for "incoming batch carried at least one m.replace"
  // (`mergeSawIncomingEditRelation`) is folded into the incoming loop
  // as a boolean flip — no extra iteration. Bumped once per merge call
  // if any incoming event had a Replace relation.
  let incomingHadEditRelation = false;
  incomingEvents.forEach((mEvent) => {
    const incomingKeys = getThreadRenderEventKeys(mEvent, resolveConfirmedId);
    if (incomingKeys.length === 0) return;

    if (mEvent.getRelation()?.rel_type === RelationType.Replace) {
      incomingHadEditRelation = true;
    }

    // setEventForKeys handles the pick + displacement internally; the
    // caller just provides the new event and its keys. This is the
    // canonicalization seam (RG5d); see setEventForKeys comment block.
    setEventForKeys(incomingKeys, mEvent);
  });
  if (incomingHadEditRelation) {
    countCacheProbe('mergeSawIncomingEditRelation');
  }

  const merged = Array.from(new Set(eventMap.values())).sort(compareThreadRenderOrder);

  // CINNY-207 AC2 render-gap RG1 (2026-07-04): observability at the
  // merge seam — bumps once per incoming m.replace whose target IS
  // present in the merged output but has NO `replacingEvent()` set.
  // That shape names "the applier ran (or was expected to run) upstream,
  // but the instance the merge kept for the target does not carry the
  // repaired replacement" — a merge-preference regression.
  //
  // F9 fold (2026-07-04): query `eventMap` directly by the target's
  // event key instead of building a fresh `Map<id, MatrixEvent>` from
  // the sorted output. Post-RG5d canonicalization the map already
  // holds exactly one instance per identity reachable under the
  // `event:${id}` key, so the lookup is O(1) with no per-call
  // allocation. Guarded on incomingHadEditRelation so the whole block
  // is skipped when the incoming batch has no edit relations.
  if (incomingHadEditRelation) {
    incomingEvents.forEach((mEvent) => {
      const relation = mEvent.getRelation();
      if (relation?.rel_type !== RelationType.Replace) return;
      const targetEventId = relation.event_id;
      if (!targetEventId) return;
      const target = eventMap.get(`event:${targetEventId}`);
      if (!target) return;
      if (!target.replacingEvent()) {
        countCacheProbe('mergeSawEditRelationNoTargetChange');
      }
    });
  }

  return merged;
};

export const dedupeThreadRenderEventEntries = <
  TEvent extends MatrixEvent,
  TEntry extends ThreadRenderEventEntry<TEvent>
>(
  entries: TEntry[],
  resolveConfirmedId?: (txnId: string) => string | undefined
): TEntry[] => {
  const dedupedEntries: TEntry[] = [];
  const keyToEntryIndex = new Map<string, number>();

  entries.forEach((entry) => {
    const entryKeys = getThreadRenderEventKeys(entry.event, resolveConfirmedId);
    if (entryKeys.length === 0) {
      dedupedEntries.push(entry);
      return;
    }

    const existingEntryIndex = entryKeys
      .map((key) => keyToEntryIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingEntryIndex === undefined) {
      const nextIndex = dedupedEntries.push(entry) - 1;
      entryKeys.forEach((key) => keyToEntryIndex.set(key, nextIndex));
      return;
    }

    const existingEntry = dedupedEntries[existingEntryIndex];
    const preferredEvent = pickPreferredThreadRenderEvent(
      existingEntry.event,
      entry.event,
      resolveConfirmedId
    ) as TEvent;
    const mergedKeys = Array.from(
      new Set([...getThreadRenderEventKeys(existingEntry.event, resolveConfirmedId), ...entryKeys])
    );

    dedupedEntries[existingEntryIndex] =
      preferredEvent === existingEntry.event
        ? ({
            ...existingEntry,
            absoluteIndex: Math.min(existingEntry.absoluteIndex, entry.absoluteIndex),
          } as TEntry)
        : ({
            ...entry,
            absoluteIndex: Math.min(existingEntry.absoluteIndex, entry.absoluteIndex),
          } as TEntry);

    mergedKeys.forEach((key) => keyToEntryIndex.set(key, existingEntryIndex));
  });

  return dedupedEntries;
};

export type TimelineRenderContextPrime = {
  prevEvent: MatrixEvent;
  isPrevRendered: boolean;
  pendingDayDivider: boolean;
};

/**
 * Computes the sequential renderer's `prevEvent`/`isPrevRendered` context as
 * it would stand just before `windowStartIndex`, for priming a virtual window
 * that does not render the preceding rows.
 *
 * Parity contract with the sequential path: events failing `isSkipped`
 * (ignored sender, hidden redaction, filtered thread reply) never touch the
 * context; every other event becomes `prevEvent` — including reaction/edit
 * events, which set `isPrevRendered = false`. Skipping edits here instead
 * (the original primer bug) makes a message that follows an edit burst group
 * as collapsed only when the window starts on it, so its height flips as the
 * window boundary crosses the burst and the row measurement cache goes stale
 * — visible flicker in edit-heavy streaming threads.
 */
export const primeTimelineRenderContextBefore = (
  getEvent: (index: number) => MatrixEvent | undefined,
  windowStartIndex: number,
  isSkipped: (event: MatrixEvent) => boolean
): TimelineRenderContextPrime | undefined => {
  let prevEvent: MatrixEvent | undefined;
  let oldestTrailing: MatrixEvent | undefined;
  let consumptionBase: MatrixEvent | undefined;
  for (let index = windowStartIndex - 1; index >= 0; index -= 1) {
    const event = getEvent(index);
    if (!event || !event.getId()) continue;
    if (isSkipped(event)) continue;
    if (!prevEvent) {
      prevEvent = event;
      // Residual approximation: a non-edit event whose renderer returns null
      // (e.g. hidden membership) sequentially yields isPrevRendered = false;
      // the collapsed check's sender/type equality makes that invisible.
      if (!reactionOrEditEvent(event)) break;
      oldestTrailing = event;
      continue;
    }
    oldestTrailing = event;
    if (!reactionOrEditEvent(event)) {
      consumptionBase = event;
      break;
    }
  }
  if (!prevEvent) return undefined;
  const isPrevRendered = !reactionOrEditEvent(prevEvent);
  // Sequential fold: dayDivider latches at any adjacent midnight crossing and
  // is only consumed (rendered) by a row with output — a crossing at a
  // null-rendering edit/reaction row carries forward to the next real
  // message. Events are ts-sorted, so a crossing exists among the trailing
  // null rows iff the endpoints differ in day: from the nearest rendered row
  // (where the last consumption happened) — or the oldest surviving event
  // when nothing before renders — up to prevEvent.
  const carryBase = consumptionBase ?? oldestTrailing;
  const pendingDayDivider =
    !isPrevRendered && carryBase !== undefined && carryBase !== prevEvent
      ? !inSameDay(carryBase.getTs(), prevEvent.getTs())
      : false;
  return { prevEvent, isPrevRendered, pendingDayDivider };
};
