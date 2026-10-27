import { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { inSameDay } from '../../utils/time';
import { getCacheProbeSnapshot, resetCacheProbe } from './cacheProbe';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  estimateThreadEventRowHeight,
  getThreadInitialRenderMode,
  isThreadFallbackReply,
  mergeThreadRenderEvents,
  pickPreferredThreadRenderEvent,
  primeTimelineRenderContextBefore,
  shouldApplyMeasurementScrollCorrection,
  shouldAutoPaginateThreadBack,
  shouldPinThreadToBottomOnOpen,
  shouldSettleLedgerAtBoundary,
} from './threadRenderUtils';

const makeMessageEvent = (eventId: string, ts = 1) =>
  new MatrixEvent({
    content: {
      body: 'hello',
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const makeLocalEchoPair = (txnId: string) => {
  const localEcho = makeMessageEvent(`~local-${txnId}`, 10);
  localEcho.setTxnId(txnId);

  const remoteEcho = makeMessageEvent(`$remote-${txnId}`, 10);
  remoteEcho.event.unsigned = {
    transaction_id: txnId,
  };

  return { localEcho, remoteEcho };
};

const makeEditEvent = (targetEventId: string, editEventId: string, ts: number) =>
  new MatrixEvent({
    content: {
      body: '* edited',
      'm.new_content': {
        body: `edited ${ts}`,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: editEventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const attachSerializedReplacement = (
  targetEvent: MatrixEvent,
  replacementEventId: string,
  ts?: number,
  sender = '@alice:example.org'
) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: '* edited',
          'm.new_content': {
            body: `edited ${ts}`,
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        ...(typeof ts === 'number' ? { origin_server_ts: ts } : {}),
        room_id: '!room:example.org',
        sender,
        type: 'm.room.message',
      },
    },
  };
};

const makeRoom = (txnMap?: Map<string, MatrixEvent>) =>
  ({
    getEventForTxnId: (txnId: string) => txnMap?.get(txnId),
  } as never);

describe('getThreadInitialRenderMode', () => {
  it('shows a loading state while initialization is pending and no events are available', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: false,
        availableEventCount: 0,
      })
    ).toBe('loading');
  });

  it('renders available thread events while initialization is pending', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: false,
        availableEventCount: 3,
      })
    ).toBe('cached');
  });

  it('switches to the live render path once initialization completes', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: true,
        availableEventCount: 0,
      })
    ).toBe('live');
  });
});

describe('pickPreferredThreadRenderEvent', () => {
  it('prefers the confirmed remote event over a local echo with the same transaction id', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-1');

    expect(pickPreferredThreadRenderEvent(localEcho, remoteEcho)).toBe(remoteEcho);
    expect(pickPreferredThreadRenderEvent(remoteEcho, localEcho)).toBe(remoteEcho);
  });

  it('keeps the existing event when it already has the newer edit applied', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });

  it('takes the incoming event when it has the newer edit applied', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));
    incomingEvent.makeReplaced(makeEditEvent('$target', '$edit-3', 3));

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(incomingEvent);
  });

  it('prefers an incoming event with a newer bundled replacement over a stale live edit', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13', 13);

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(incomingEvent);
  });

  it('ignores bundled replacements without origin_server_ts when picking the preferred event', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13');

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });

  it('ignores bundled replacements from other senders when picking the preferred event', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13', 13, '@mallory:example.org');

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });

  // Review candidate-3 (2026-07-04): the picker's local-echo branch
  // returns early, BEFORE the replacement-preference rules. A repaired
  // cache-hydrated instance has a real event id and isSending()=false,
  // so it must never classify as a local echo and lose to an
  // unrepaired sync-delivered instance — even when it carries local
  // send metadata (unsigned.transaction_id persisted at seed time),
  // which makes its key set intersect the incoming instance's on both
  // the event and txn dimensions.
  it('keeps a repaired confirmed instance over an unrepaired sync instance despite txn metadata', () => {
    const repairedHydrated = makeMessageEvent('$target');
    repairedHydrated.event.unsigned = { transaction_id: 'txn-repair-1' };
    // Foreign-sender raw replacement: the effective-replacement block
    // yields nothing for either side (sender-mismatch filter), so the
    // decision falls through the local-echo branch and the effective
    // block to the asymmetric raw-presence rule.
    const foreignEdit = makeEditEvent('$target', '$edit-2', 2);
    foreignEdit.event.sender = '@mallory:example.org';
    repairedHydrated.makeReplaced(foreignEdit);
    const syncInstance = makeMessageEvent('$target');

    expect(repairedHydrated.isSending()).toBe(false);
    expect(syncInstance.isSending()).toBe(false);
    expect(pickPreferredThreadRenderEvent(repairedHydrated, syncInstance)).toBe(repairedHydrated);
    expect(pickPreferredThreadRenderEvent(syncInstance, repairedHydrated)).toBe(repairedHydrated);
  });
});

describe('shouldAutoPaginateThreadBack', () => {
  const base = {
    threadId: '$thread',
    firstRenderedIndex: 10,
    paginatingBack: false,
    showLoadOlder: true,
    hasUserScrollIntent: true,
    triggerRows: 15,
  };

  it('fires when the rendered window top is within the trigger headroom', () => {
    expect(shouldAutoPaginateThreadBack(base)).toBe(true);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 15 })).toBe(true);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 0 })).toBe(true);
  });

  it('does not fire while the rendered window is deeper than the headroom', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 16 })).toBe(false);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 400 })).toBe(false);
  });

  it('does not fire outside a thread or before anything rendered', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, threadId: undefined })).toBe(false);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: undefined })).toBe(false);
  });

  it('is single-flight: does not re-fire while a back-pagination is in progress', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, paginatingBack: true })).toBe(false);
  });

  it('does not fire when no older content exists (chip condition is false)', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, showLoadOlder: false })).toBe(false);
  });

  it('does not fire before any real user scroll gesture', () => {
    // Before a gesture, a low rendered index is the open-time pre-pin
    // transient (the virtualizer briefly renders from index 0), not a
    // user scrolled to the top. Note this gate is user intent, NOT the
    // open-lifecycle pending flag — that flag stays true for the whole
    // open-time backfill chain, which on slow networks is exactly when
    // a scrolling user needs the trigger live.
    expect(shouldAutoPaginateThreadBack({ ...base, hasUserScrollIntent: false })).toBe(false);
  });
});

describe('estimateThreadEventRowHeight', () => {
  const modern = { compact: false };

  it('estimates a one-liner at base + one text line', () => {
    expect(estimateThreadEventRowHeight(makeMessageEvent('$short'), modern)).toBe(30);
  });

  it('adds a line per newline for short bodies', () => {
    const event = new MatrixEvent({
      content: { body: 'a\nb\nc', msgtype: 'm.text' },
      event_id: '$multi',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(70);
  });

  it('caps anything past the fold at the collapsed height (long body)', () => {
    const event = new MatrixEvent({
      content: { body: 'x'.repeat(2000), msgtype: 'm.text' },
      event_id: '$long',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(190);
  });

  it('caps short-but-many-lines bodies at the collapsed height too', () => {
    const event = new MatrixEvent({
      content: { body: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', msgtype: 'm.text' },
      event_id: '$lines',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(190);
  });

  it.each(['m.replace', 'm.annotation'])('reserves no scroll space for %s relations', (relType) => {
    const edit = new MatrixEvent({
      content: {
        body: '* fixed',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: relType, event_id: '$target' },
      },
      event_id: '$edit',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(edit, modern)).toBe(0);
  });

  it('estimates a thread summary at its one-line marker', () => {
    const summary = 'Fixing iOS push token refresh while the app is suspended\n'.repeat(4);
    const event = new MatrixEvent({
      content: {
        body: summary,
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': { version: 1, summary, message_count: 21 },
      },
      event_id: '$summary',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@code:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(30);
  });

  it('uses the smaller compact base', () => {
    expect(estimateThreadEventRowHeight(makeMessageEvent('$compact'), { compact: true })).toBe(26);
  });

  it('estimates always-expanded extras rows uncapped with section-header allowance', () => {
    const body = Array.from({ length: 10 }, (_v, line) => `answer line ${line}`).join('\n');
    const event = new MatrixEvent({
      content: {
        body,
        msgtype: 'm.text',
        'com.mindroom.message_extras': {
          version: 2,
          sections: [
            { title: 'Tool call 1', content_type: 'text/markdown', content: 'output 1' },
            { title: 'Tool call 2', content_type: 'text/markdown', content: 'output 2' },
          ],
        },
      },
      event_id: '$extras',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    // 10 physical lines, none wrapping at 48 chars = 10 lines; base 10 +
    // 10*20 + 2 section headers * 40 (calibrated constants). NOT the
    // folded 80: these rows never fold, and estimating them small caused
    // the per-frame jump budget the ride-smoothness e2e pins.
    expect(estimateThreadEventRowHeight(event, modern)).toBe(10 + 10 * 20 + 2 * 40);
  });

  it('bounds pathological always-expanded bodies at the line cap', () => {
    const event = new MatrixEvent({
      content: {
        body: 'x\n'.repeat(10_000),
        msgtype: 'm.text',
        'com.mindroom.message_extras': {
          version: 2,
          sections: [{ title: 'Tool', content_type: 'text/markdown', content: 'y' }],
        },
      },
      event_id: '$huge',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(10 + 48 * 20 + 40);
  });
});

describe('shouldSettleLedgerAtBoundary', () => {
  // Viewport 600px tall at client top 0; guard band = 2 viewports.
  // 60000px of content bounds the physical range at offset 59400.
  const base = {
    scrollTop: 0,
    scrollBottom: 600,
    scrollOffset: 1000,
    clientHeight: 600,
    scrollHeight: 60000,
    scrollDirection: 'backward' as const,
  };

  it('ignores small debts (ordinary rests settle them invisibly)', () => {
    expect(
      shouldSettleLedgerAtBoundary({ ...base, ledgerPx: -40, innerTop: 100, innerBottom: 5000 })
    ).toBe(false);
    expect(
      shouldSettleLedgerAtBoundary({ ...base, ledgerPx: 40, innerTop: -5000, innerBottom: 500 })
    ).toBe(false);
  });

  it('settles shrink-debt when the content start approaches the viewport (top dead zone)', () => {
    // px<0: positive margin above the content. Content start 800px below
    // the viewport top is inside the 1200px guard band.
    expect(
      shouldSettleLedgerAtBoundary({ ...base, ledgerPx: -5000, innerTop: 800, innerBottom: 60000 })
    ).toBe(true);
    // Far from the boundary: no settle, the ride keeps its momentum.
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        ledgerPx: -5000,
        innerTop: -20000,
        innerBottom: 60000,
      })
    ).toBe(false);
  });

  it('settles grow-debt when the content end approaches the viewport (bottom dead zone)', () => {
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'forward',
        ledgerPx: 5000,
        innerTop: -60000,
        innerBottom: 1500,
      })
    ).toBe(true);
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'forward',
        ledgerPx: 5000,
        innerTop: -60000,
        innerBottom: 20000,
      })
    ).toBe(false);
  });

  it('does not settle the bottom edge while an upward fling is moving away from it', () => {
    // iPhone trace ride-trace-1783779812509: a positive ledger put the
    // bottom edge inside the old two-viewport guard while native momentum
    // was still moving backward (scrollTop -18px on the preceding frame).
    // The direction-blind guard wrote +72px, reversed the frame by +37px,
    // and stopped the fling. The endangered edge is receding here, so the
    // ledger remains coherent without a boundary rebase.
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'backward',
        ledgerPx: 72,
        innerTop: -34000,
        innerBottom: 1500,
      })
    ).toBe(false);
  });

  it('does not settle the top edge while a downward ride is moving away from it', () => {
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'forward',
        ledgerPx: -5000,
        innerTop: -800,
        innerBottom: 60000,
      })
    ).toBe(false);
  });

  it('lets positive-ledger rides use the remaining physical top runway', () => {
    // Native trace ride-trace-1783784177182: ledger +89px, innerTop
    // -1114px, and reachable content top -1025px. The old two-viewport
    // guard paid that ledger while native momentum was still moving about
    // -56px/frame, reversing the sampled frame and stopping the fling.
    // Positive ledger pulls the content box upward but does not expose a
    // blank margin, so this remaining physical scroll range is safe runway.
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        ledgerPx: 89,
        innerTop: -1114,
        innerBottom: 60000,
      })
    ).toBe(false);
    // At physical exhaustion, settle immediately so the folded prefix
    // becomes reachable without waiting for ordinary quiescence.
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollOffset: 0,
        ledgerPx: 3000,
        innerTop: -3000,
        innerBottom: 60000,
      })
    ).toBe(true);
  });

  it('does not mistake normal-flow top padding for physical exhaustion', () => {
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollOffset: 9,
        ledgerPx: 89,
        innerTop: -80,
        innerBottom: 60000,
      })
    ).toBe(false);
  });

  it('settles already-crossed ledger edges even when the last delta points away', () => {
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'forward',
        ledgerPx: -5000,
        innerTop: 10,
        innerBottom: 60000,
      })
    ).toBe(true);
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollDirection: 'backward',
        ledgerPx: 5000,
        innerTop: -60000,
        innerBottom: 590,
      })
    ).toBe(true);
  });

  it('defers settles while the scroller is rubber-banding out of bounds', () => {
    // iPad trace ride-trace-1783802452438 frame 192: a grow-debt settle
    // written 64px past the bottom edge, mid-bounce, slipped 87px. The
    // same crossed-edge geometry settles in bounds (previous test); past
    // either physical edge it waits for the bounce's landing event or the
    // zero-slip quiescence settle.
    const crossedBottom = {
      ...base,
      scrollDirection: 'backward' as const,
      ledgerPx: 5000,
      innerTop: -60000,
      innerBottom: 590,
    };
    expect(shouldSettleLedgerAtBoundary({ ...crossedBottom, scrollOffset: 59464 })).toBe(false);
    // Top rubber band defers the physical-exhaustion settle the same way;
    // the landing event at offset 0 still fires it (covered above by the
    // positive-ledger physical-exhaustion test).
    expect(
      shouldSettleLedgerAtBoundary({
        ...base,
        scrollOffset: -30,
        ledgerPx: 3000,
        innerTop: -3000,
        innerBottom: 60000,
      })
    ).toBe(false);
    // Fractional-offset slack: the exact bottom edge is NOT overscroll.
    expect(shouldSettleLedgerAtBoundary({ ...crossedBottom, scrollOffset: 59400.5 })).toBe(true);
  });
});

describe('shouldApplyMeasurementScrollCorrection', () => {
  const base = {
    itemFullyAboveViewport: true,
    isIOSWebKitDevice: true,
    isScrollingBackward: false,
  };

  it('never applies on iOS — corrections are ledgered, not written', () => {
    // Mid-scroll writes kill momentum; even quiet applies proved unsafe
    // (virtual-core's internal bursts clamp near the top edge, silently
    // under-applying — the prepend e2e photographed a scrollTo(-44)).
    expect(shouldApplyMeasurementScrollCorrection(base)).toBe(false);
  });

  it('keeps immediate desktop anchoring while quiet or moving forward', () => {
    expect(shouldApplyMeasurementScrollCorrection({ ...base, isIOSWebKitDevice: false })).toBe(
      true
    );
  });

  it('ledgers desktop corrections while scrolling backward', () => {
    expect(
      shouldApplyMeasurementScrollCorrection({
        ...base,
        isIOSWebKitDevice: false,
        isScrollingBackward: true,
      })
    ).toBe(false);
  });

  it('never adjusts for visible (straddling) or below-viewport items', () => {
    expect(
      shouldApplyMeasurementScrollCorrection({
        ...base,
        itemFullyAboveViewport: false,
      })
    ).toBe(false);
  });
});

describe('shouldPinThreadToBottomOnOpen', () => {
  it('pins a plain thread open once cached or live events are ready to render', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'cached',
        threadEventCount: 3,
      })
    ).toBe(true);
  });

  it('does not pin while the initial thread render is still loading', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'loading',
        threadEventCount: 3,
      })
    ).toBe(false);
  });

  it('does not pin targeted thread opens or empty thread renders', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadOpenedAtLatest: false,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 3,
      })
    ).toBe(false);
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 0,
      })
    ).toBe(false);
  });

  it('keeps the pin through post-chain hydration bands until the first gesture', () => {
    // Device symptom (2026-07-06 trace round): open at the bottom, then
    // history bands landing AFTER the open chain completed dragged the
    // view to mid-thread. The latch holds the pin; a real gesture ends it.
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 300,
      })
    ).toBe(true);
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: true,
        threadInitialRenderMode: 'live',
        threadEventCount: 300,
      })
    ).toBe(false);
  });

  it('does not pin while thread back-pagination suppresses open-bottom pinning', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 3,
        suppressOpenBottomPin: true,
      })
    ).toBe(false);
  });
});

describe('mergeThreadRenderEvents', () => {
  it('does not overwrite a corrected cached event with a stale duplicate', () => {
    const correctedEvent = makeMessageEvent('$target');
    correctedEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));
    const staleDuplicate = makeMessageEvent('$target');

    expect(mergeThreadRenderEvents([correctedEvent], [staleDuplicate])).toEqual([correctedEvent]);
  });

  it('deduplicates local echo and confirmed thread events using transaction id', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-2');

    expect(mergeThreadRenderEvents([localEcho], [remoteEcho])).toEqual([remoteEcho]);
    expect(mergeThreadRenderEvents([remoteEcho], [localEcho])).toEqual([remoteEcho]);
  });

  it('deduplicates identical remote events even when only one copy still carries the transaction id', () => {
    const confirmedWithTxn = makeMessageEvent('$remote', 10);
    confirmedWithTxn.event.unsigned = { transaction_id: 'txn-3' };
    const confirmedWithoutTxn = makeMessageEvent('$remote', 10);

    expect(mergeThreadRenderEvents([confirmedWithTxn], [confirmedWithoutTxn])).toEqual([
      confirmedWithoutTxn,
    ]);
    expect(mergeThreadRenderEvents([confirmedWithoutTxn], [confirmedWithTxn])).toEqual([
      confirmedWithTxn,
    ]);
  });

  it('deduplicates local echo and confirmed event when confirmed lacks transaction_id but resolver provides the link', () => {
    const localEcho = makeMessageEvent('~local-txn-4', 10);
    localEcho.setTxnId('txn-4');
    const confirmed = makeMessageEvent('$remote-txn-4', 10);

    const resolver = (txnId: string) => (txnId === 'txn-4' ? '$remote-txn-4' : undefined);

    expect(mergeThreadRenderEvents([], [localEcho, confirmed], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([], [confirmed, localEcho], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([localEcho], [confirmed], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([confirmed], [localEcho], resolver)).toEqual([confirmed]);
  });

  it('keeps both events when resolver returns undefined (no confirmed id known)', () => {
    const localEcho = makeMessageEvent('~local-txn-5', 10);
    localEcho.setTxnId('txn-5');
    const unrelated = makeMessageEvent('$other', 10);

    const resolver = () => undefined;

    const result = mergeThreadRenderEvents([], [localEcho, unrelated], resolver);
    expect(result).toHaveLength(2);
  });

  it('deduplicates multiple local echoes each with their own confirmed counterpart', () => {
    const echo1 = makeMessageEvent('~local-a', 10);
    echo1.setTxnId('txn-a');
    const confirmed1 = makeMessageEvent('$remote-a', 10);

    const echo2 = makeMessageEvent('~local-b', 20);
    echo2.setTxnId('txn-b');
    const confirmed2 = makeMessageEvent('$remote-b', 20);

    const resolver = (txnId: string) => {
      if (txnId === 'txn-a') return '$remote-a';
      if (txnId === 'txn-b') return '$remote-b';
      return undefined;
    };

    const result = mergeThreadRenderEvents([], [echo1, confirmed1, echo2, confirmed2], resolver);
    expect(result).toEqual([confirmed1, confirmed2]);
  });

  it('resolver does not affect non-local-echo events', () => {
    const confirmed = makeMessageEvent('$remote', 10);
    confirmed.event.unsigned = { transaction_id: 'txn-6' };

    const resolver = (txnId: string) => (txnId === 'txn-6' ? '$other' : undefined);

    const result = mergeThreadRenderEvents([], [confirmed], resolver);
    expect(result).toEqual([confirmed]);
    expect(result).toHaveLength(1);
  });
});

// CINNY-207 AC2 render-gap RG5d (2026-07-04): key-canonicalization
// invariant. `mergeThreadRenderEvents` maintains one MatrixEvent
// instance per event identity in its internal `eventMap` regardless of
// how many key sets the incoming events arrive under. The tests below
// exercise the dual-key scenarios team-lead named in the B-approval /
// RG5c-approval messages: entry under {txnId, eventId} followed by a
// second instance under {eventId} only. Post-canonicalization, the map
// must resolve to exactly one instance reachable under both keys, and
// (per the replacement-preferring rule) that instance must be the one
// carrying an effective replacement.
describe('mergeThreadRenderEvents RG5d key canonicalization', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  const makeMessageEventWithReplacement = (eventId: string, ts: number, editTs: number) => {
    const target = makeMessageEvent(eventId, ts);
    const edit = makeEditEvent(eventId, `$edit-${eventId}`, editTs);
    target.makeReplaced(edit);
    return target;
  };

  it('collapses a dual-key entry and a same-id single-key entry to one instance under both keys', () => {
    // Team-lead's dual-key scenario, verbatim: event enters under
    // {txnId, id}, second instance arrives under {id} only, map ends
    // with exactly one instance reachable under both keys, and it's
    // the replacement-carrying one (per the picker's preference rule
    // from RG5-fix2).
    const dualKey = makeMessageEvent('$remote-dual', 10);
    dualKey.event.unsigned = { transaction_id: 'txn-dual' };
    const singleKeyRepaired = makeMessageEventWithReplacement('$remote-dual', 10, 15);

    // Existing = dual-key without replacement.
    // Incoming = single-key WITH replacement.
    // Picker must prefer the replacement-carrying instance (asymmetric
    // raw check from 3fbe8afd). Canonicalizer must displace the loser
    // from BOTH of its keys, and install the winner under the union.
    const result = mergeThreadRenderEvents([dualKey], [singleKeyRepaired]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(singleKeyRepaired);
    // Displacement was observable.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
  });

  it('does not bump the displacement counter when incoming has no conflict', () => {
    const first = makeMessageEvent('$a', 10);
    const second = makeMessageEvent('$b', 20);
    const result = mergeThreadRenderEvents([first], [second]);
    expect(result).toHaveLength(2);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('does not bump when the same instance is re-registered', () => {
    const shared = makeMessageEvent('$same', 10);
    // Both loops write the same instance under the same keys; no
    // conflict, no displacement.
    const result = mergeThreadRenderEvents([shared], [shared]);
    expect(result).toEqual([shared]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('preserves the winner even when the loser held a key the winner did not', () => {
    // Losing instance has a txnId the winner never had. The
    // canonicalizer must reclaim that key onto the winner so any
    // consumer looking up by txnId still resolves to the winner.
    const withTxn = makeMessageEvent('$id', 10);
    withTxn.event.unsigned = { transaction_id: 'txn-lost' };
    const winnerRepaired = makeMessageEventWithReplacement('$id', 10, 15);

    const result = mergeThreadRenderEvents([withTxn], [winnerRepaired]);
    expect(result).toEqual([winnerRepaired]);
    // Downstream reachability check: the winner survives regardless
    // of which key a subsequent merge cycle happens to observe.
    // Simulate a subsequent merge that supplies only the loser's
    // txnId — the winner must still be the resolvable instance for
    // that id via the picker's normal `mergedKeys` logic.
    const later = makeMessageEvent('$id', 10);
    later.event.unsigned = { transaction_id: 'txn-lost' };
    const secondPass = mergeThreadRenderEvents(result, [later]);
    // The second-pass picker will prefer the raw-replacement carrier
    // (winnerRepaired) over `later` per the asymmetric rule from
    // RG5-fix2, so the survivor is still the repaired instance.
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]).toBe(winnerRepaired);
  });

  it('bumps displacements per losing instance in a 3-way conflict, not per key', () => {
    // Three instances of the same event id arrive across the two
    // input arrays, with partially overlapping keys. Two of them
    // must lose; the counter must bump exactly twice (per-instance).
    const a = makeMessageEvent('$same', 10);
    a.event.unsigned = { transaction_id: 'txn-a' };
    const b = makeMessageEvent('$same', 10);
    b.event.unsigned = { transaction_id: 'txn-b' };
    const cRepaired = makeMessageEventWithReplacement('$same', 10, 15);

    const result = mergeThreadRenderEvents([a, b], [cRepaired]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cRepaired);
    // Two losers displaced (a and b). Note: existingEvents pass writes
    // a, then b — b already conflicts with a via `event:$same`, so b
    // triggers a displacement of a. Then incoming cRepaired displaces
    // b. Total per-instance displacements: 2.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(2);
  });

  it('symmetric — replacement-carrier wins whether it is existing or incoming', () => {
    const bareA = makeMessageEvent('$id', 10);
    bareA.event.unsigned = { transaction_id: 'txn-x' };
    const repairedA = makeMessageEventWithReplacement('$id', 10, 15);

    // Existing repaired, incoming bare — repaired must win.
    expect(mergeThreadRenderEvents([repairedA], [bareA])).toEqual([repairedA]);
    resetCacheProbe();

    const bareB = makeMessageEvent('$id2', 10);
    bareB.event.unsigned = { transaction_id: 'txn-y' };
    const repairedB = makeMessageEventWithReplacement('$id2', 10, 15);

    // Existing bare, incoming repaired — repaired must win.
    expect(mergeThreadRenderEvents([bareB], [repairedB])).toEqual([repairedB]);
  });

  it('permanent must-stay-0 tripwire: registrySwappedRepairedForUnrepaired never fires under the picker rule', () => {
    // The RG5c tripwire re-homed at the canonicalization site (per
    // team-lead's F1 correction): must stay 0 across every scenario the
    // picker guards. Any non-zero reading names a picker-rule violation
    // (a loser carried `.replacingEvent()` non-null while the chosen
    // winner had it null — the RG5-fix2 raw-presence rule was
    // bypassed).
    //
    // Exercise every RG5d scenario in one describe-scoped assertion so
    // the invariant is checked against the full canonicalizer surface,
    // not just one path.
    resetCacheProbe();
    const scenarios: Array<() => void> = [
      // Simple dual-key + single-key collapse.
      () => {
        const dual = makeMessageEvent('$s1', 10);
        dual.event.unsigned = { transaction_id: 'txn-s1' };
        const repaired = makeMessageEventWithReplacement('$s1', 10, 15);
        mergeThreadRenderEvents([dual], [repaired]);
      },
      // Reversed: existing repaired, incoming bare.
      () => {
        const dual = makeMessageEvent('$s2', 10);
        dual.event.unsigned = { transaction_id: 'txn-s2' };
        const repaired = makeMessageEventWithReplacement('$s2', 10, 15);
        mergeThreadRenderEvents([repaired], [dual]);
      },
      // Three-way conflict.
      () => {
        const a = makeMessageEvent('$s3', 10);
        a.event.unsigned = { transaction_id: 'txn-3a' };
        const b = makeMessageEvent('$s3', 10);
        b.event.unsigned = { transaction_id: 'txn-3b' };
        const repaired = makeMessageEventWithReplacement('$s3', 10, 15);
        mergeThreadRenderEvents([a, b], [repaired]);
      },
      // Neither side carries replacement — tripwire must not fire.
      () => {
        const a = makeMessageEvent('$s4', 10);
        a.event.unsigned = { transaction_id: 'txn-4' };
        const b = makeMessageEvent('$s4', 10);
        mergeThreadRenderEvents([a], [b]);
      },
    ];
    scenarios.forEach((run) => run());
    expect(getCacheProbeSnapshot().registrySwappedRepairedForUnrepaired).toBe(0);
  });

  // Greptile P2 on PR #73: two DISTINCT confirmed events that happen to
  // share a transaction_id (server misbehavior / cross-device
  // coincidence) are separate identities. The shared `txn:` key must
  // not let one displace the other's `event:` entry — pre-fix, the
  // conflict scan treated any key collision as same-identity and
  // silently dropped one real message from the merge output.
  it('keeps two distinct confirmed events that share a transaction id', () => {
    const first = makeMessageEvent('$distinct-1', 10);
    first.event.unsigned = { transaction_id: 'txn-shared' };
    const second = makeMessageEvent('$distinct-2', 11);
    second.event.unsigned = { transaction_id: 'txn-shared' };

    const merged = mergeThreadRenderEvents([first], [second]);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(first);
    expect(merged).toContain(second);
    // Distinct identities — no displacement work should be counted.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('still collapses a local echo with its own confirmed event across a shared txn key', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-collapse');

    const merged = mergeThreadRenderEvents([localEcho], [remoteEcho]);

    expect(merged).toEqual([remoteEcho]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
  });

  // Greptile P1 on PR #73: an echo whose txn already RESOLVES to a
  // known confirmed id must not collapse a DIFFERENT confirmed event
  // that reuses its transaction key — the echo-confirmation bridge
  // only applies to the echo's own confirmation.
  it('does not let a resolved local echo collapse a different confirmed event reusing its txn key', () => {
    const localEcho = makeMessageEvent('~local-txn-x', 10);
    localEcho.setTxnId('txn-x');
    const impostor = makeMessageEvent('$real-b', 11);
    impostor.event.unsigned = { transaction_id: 'txn-x' };
    // Resolver knows txn-x confirms to $real-a — NOT the impostor.
    const resolver = (txnId: string) => (txnId === 'txn-x' ? '$real-a' : undefined);

    const merged = mergeThreadRenderEvents([localEcho], [impostor], resolver);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(localEcho);
    expect(merged).toContain(impostor);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('collapses an unresolved local echo with a same-txn confirmed arrival (the confirmation)', () => {
    const localEcho = makeMessageEvent('~local-txn-y', 10);
    localEcho.setTxnId('txn-y');
    const confirmation = makeMessageEvent('$real-y', 10);
    confirmation.event.unsigned = { transaction_id: 'txn-y' };
    // No resolver: the echo's confirmed id is not yet known, so a
    // same-txn confirmed arrival IS the confirmation by definition.
    const merged = mergeThreadRenderEvents([localEcho], [confirmation]);

    expect(merged).toEqual([confirmation]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
  });
});

describe('buildResolveConfirmedEventId', () => {
  it('falls back to non-local events when room lookup has not learned the confirmed id yet', () => {
    const localEcho = makeMessageEvent('~local-txn-fallback', 10);
    localEcho.setTxnId('txn-fallback');
    const confirmed = makeMessageEvent('$remote-txn-fallback', 10);
    confirmed.event.unsigned = { transaction_id: 'txn-fallback' };

    const resolveConfirmedId = buildResolveConfirmedEventId(makeRoom(), [localEcho, confirmed]);

    expect(resolveConfirmedId('txn-fallback')).toBe('$remote-txn-fallback');
  });
});

describe('dedupeThreadRenderEventEntries', () => {
  it('replaces a room local echo entry with its confirmed event entry', () => {
    const localEcho = makeMessageEvent('~local-txn-room', 10);
    localEcho.setTxnId('txn-room');
    const confirmed = makeMessageEvent('$remote-txn-room', 10);

    const entries = dedupeThreadRenderEventEntries(
      [
        { event: localEcho, absoluteIndex: 249 },
        { event: confirmed, absoluteIndex: 253 },
      ],
      (txnId: string) => (txnId === 'txn-room' ? '$remote-txn-room' : undefined)
    );

    expect(entries).toEqual([{ event: confirmed, absoluteIndex: 249 }]);
  });

  it('keeps unrelated room entries in order while removing the stale local echo duplicate', () => {
    const earlier = makeMessageEvent('$earlier', 5);
    const localEcho = makeMessageEvent('~local-txn-room-2', 10);
    localEcho.setTxnId('txn-room-2');
    const confirmed = makeMessageEvent('$remote-txn-room-2', 10);
    const later = makeMessageEvent('$later', 20);

    const entries = dedupeThreadRenderEventEntries(
      [
        { event: earlier, absoluteIndex: 10 },
        { event: localEcho, absoluteIndex: 11 },
        { event: confirmed, absoluteIndex: 12 },
        { event: later, absoluteIndex: 13 },
      ],
      (txnId: string) => (txnId === 'txn-room-2' ? '$remote-txn-room-2' : undefined)
    );

    expect(entries).toEqual([
      { event: earlier, absoluteIndex: 10 },
      { event: confirmed, absoluteIndex: 11 },
      { event: later, absoluteIndex: 13 },
    ]);
  });
});

const DAY_MS = 86_400_000;

describe('primeTimelineRenderContextBefore', () => {
  const makeReactionEvent = (eventId: string, targetEventId: string, ts: number) =>
    new MatrixEvent({
      content: {
        'm.relates_to': {
          event_id: targetEventId,
          key: '👍',
          rel_type: 'm.annotation',
        },
      },
      event_id: eventId,
      origin_server_ts: ts,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.reaction',
    });

  const never = () => false;

  it('marks a preceding normal message as rendered', () => {
    const events = [makeMessageEvent('$a', 1), makeMessageEvent('$b', 2)];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 1, never);
    expect(primed?.prevEvent.getId()).toBe('$a');
    expect(primed?.isPrevRendered).toBe(true);
  });

  it('keeps a preceding edit as prevEvent with isPrevRendered false, matching the sequential path', () => {
    // Sequential rendering sets prevEvent to the edit itself (rendered null),
    // so the following message never collapses. The primer must agree, or the
    // row's height flips as the virtual window boundary crosses the edit.
    const events = [
      makeMessageEvent('$a', 1),
      makeEditEvent('$a', '$edit-1', 2),
      makeMessageEvent('$b', 3),
    ];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 2, never);
    expect(primed?.prevEvent.getId()).toBe('$edit-1');
    expect(primed?.isPrevRendered).toBe(false);
  });

  it('treats a preceding reaction like an edit', () => {
    const events = [
      makeMessageEvent('$a', 1),
      makeReactionEvent('$react-1', '$a', 2),
      makeMessageEvent('$b', 3),
    ];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 2, never);
    expect(primed?.prevEvent.getId()).toBe('$react-1');
    expect(primed?.isPrevRendered).toBe(false);
  });

  it('passes over skipped events to the nearest surviving one', () => {
    const events = [
      makeMessageEvent('$a', 1),
      makeMessageEvent('$ignored', 2),
      makeMessageEvent('$b', 3),
    ];
    const primed = primeTimelineRenderContextBefore(
      (i) => events[i],
      2,
      (event) => event.getId() === '$ignored'
    );
    expect(primed?.prevEvent.getId()).toBe('$a');
    expect(primed?.isPrevRendered).toBe(true);
  });

  it('returns undefined when nothing precedes the window', () => {
    const events = [makeMessageEvent('$a', 1)];
    expect(primeTimelineRenderContextBefore((i) => events[i], 0, never)).toBeUndefined();
    expect(
      primeTimelineRenderContextBefore(
        (i) => events[i],
        1,
        () => true
      )
    ).toBeUndefined();
  });

  it('carries a pending day divider latched at a trailing edit', () => {
    // Sequential fold: the midnight crossing is detected at the (null-
    // rendered) edit row and carried until the next real message consumes
    // it; the primer must reconstruct that carry or the date divider (and
    // the row's height) flips with the virtual window boundary.
    const events = [
      makeMessageEvent('$m1', 1_000),
      makeEditEvent('$m1', '$e1', 1_000 + 3 * DAY_MS),
      makeMessageEvent('$m2', 1_000 + 3 * DAY_MS + 60_000),
    ];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 2, never);
    expect(primed?.prevEvent.getId()).toBe('$e1');
    expect(primed?.pendingDayDivider).toBe(true);
  });

  it('does not carry a day divider when the trailing edits stay in the same day', () => {
    const events = [
      makeMessageEvent('$m1', 1_000),
      makeEditEvent('$m1', '$e1', 2_000),
      makeMessageEvent('$m2', 3_000),
    ];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 2, never);
    expect(primed?.pendingDayDivider).toBe(false);
  });

  it('treats a rendered previous row as having consumed the divider', () => {
    // M2 renders on day 2 and consumes the divider; a window starting after
    // it must not re-carry the crossing.
    const events = [
      makeMessageEvent('$m1', 1_000),
      makeEditEvent('$m1', '$e1', 1_000 + 3 * DAY_MS),
      makeMessageEvent('$m2', 1_000 + 3 * DAY_MS + 60_000),
      makeMessageEvent('$m3', 1_000 + 3 * DAY_MS + 120_000),
    ];
    const primed = primeTimelineRenderContextBefore((i) => events[i], 3, never);
    expect(primed?.prevEvent.getId()).toBe('$m2');
    expect(primed?.pendingDayDivider).toBe(false);
  });

  it('carries a crossing that happens between two leading edits with nothing rendered before', () => {
    const events = [
      makeEditEvent('$x', '$e1', 1_000),
      makeEditEvent('$x', '$e2', 1_000 + 3 * DAY_MS),
      makeMessageEvent('$m1', 1_000 + 3 * DAY_MS + 60_000),
    ];
    expect(primeTimelineRenderContextBefore((i) => events[i], 2, never)?.pendingDayDivider).toBe(
      true
    );
    // A single leading edit has no adjacent pair before it: no carry.
    expect(primeTimelineRenderContextBefore((i) => events[i], 1, never)?.pendingDayDivider).toBe(
      false
    );
  });

  it('matches folding the sequential context update over every prior event', () => {
    // Sequential parity property: for any window start, priming must equal
    // applying the sequential rule in order — skipped events untouched;
    // every other event becomes prevEvent (rendered iff not a
    // reaction/edit); the day divider latches on any adjacent crossing and
    // resets only when a rendered row consumes it.
    const events = [
      makeMessageEvent('$m1', 1_000),
      makeEditEvent('$m1', '$e1', 2_000),
      makeEditEvent('$m1', '$e2', 1_000 + 3 * DAY_MS),
      makeMessageEvent('$skip-me', 1_000 + 3 * DAY_MS + 1_000),
      makeMessageEvent('$m2', 1_000 + 3 * DAY_MS + 2_000),
      makeReactionEvent('$r1', '$m2', 1_000 + 6 * DAY_MS),
      makeMessageEvent('$m3', 1_000 + 6 * DAY_MS + 1_000),
      makeEditEvent('$m3', '$e3', 1_000 + 9 * DAY_MS),
    ];
    const isSkipped = (event: MatrixEvent) => event.getId() === '$skip-me';
    const isEditOrReaction = (event: MatrixEvent) =>
      ['m.annotation', 'm.replace'].includes(
        (event.getContent()['m.relates_to'] as { rel_type?: string } | undefined)?.rel_type ?? ''
      );

    for (let windowStart = 0; windowStart <= events.length; windowStart += 1) {
      let foldedPrev: MatrixEvent | undefined;
      let foldedRendered = false;
      let foldedDayDivider = false;
      for (let i = 0; i < windowStart; i += 1) {
        const event = events[i];
        if (isSkipped(event)) continue;
        if (!foldedDayDivider) {
          foldedDayDivider = foldedPrev ? !inSameDay(foldedPrev.getTs(), event.getTs()) : false;
        }
        foldedPrev = event;
        foldedRendered = !isEditOrReaction(event);
        if (foldedRendered) {
          foldedDayDivider = false;
        }
      }

      const primed = primeTimelineRenderContextBefore((i) => events[i], windowStart, isSkipped);
      expect(primed?.prevEvent.getId()).toBe(foldedPrev?.getId());
      expect(primed?.isPrevRendered ?? false).toBe(foldedRendered);
      expect(primed?.pendingDayDivider ?? false).toBe(foldedDayDivider);
    }
  });
});

describe('isThreadFallbackReply', () => {
  const makeReplyEvent = (relatesTo?: Record<string, unknown>) =>
    new MatrixEvent({
      content: {
        body: 'hello',
        msgtype: 'm.text',
        ...(relatesTo ? { 'm.relates_to': relatesTo } : {}),
      },
      event_id: '$reply:example.org',
      origin_server_ts: 10,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });

  it('is true for a thread reply whose in_reply_to is only a fallback', () => {
    const event = makeReplyEvent({
      rel_type: 'm.thread',
      event_id: '$root:example.org',
      is_falling_back: true,
      'm.in_reply_to': { event_id: '$prev:example.org' },
    });
    expect(isThreadFallbackReply(event)).toBe(true);
  });

  it('is false for an explicit reply inside a thread', () => {
    const event = makeReplyEvent({
      rel_type: 'm.thread',
      event_id: '$root:example.org',
      is_falling_back: false,
      'm.in_reply_to': { event_id: '$target:example.org' },
    });
    expect(isThreadFallbackReply(event)).toBe(false);
  });

  it('is false for a thread reply without the fallback flag', () => {
    const event = makeReplyEvent({
      rel_type: 'm.thread',
      event_id: '$root:example.org',
      'm.in_reply_to': { event_id: '$target:example.org' },
    });
    expect(isThreadFallbackReply(event)).toBe(false);
  });

  it('is false for a plain rich reply outside threads', () => {
    const event = makeReplyEvent({
      'm.in_reply_to': { event_id: '$target:example.org' },
    });
    expect(isThreadFallbackReply(event)).toBe(false);
  });

  it('is false for non-thread relations even with the flag set', () => {
    const event = makeReplyEvent({
      rel_type: 'm.replace',
      event_id: '$target:example.org',
      is_falling_back: true,
    });
    expect(isThreadFallbackReply(event)).toBe(false);
  });

  it('is false for a message without relations', () => {
    expect(isThreadFallbackReply(makeReplyEvent())).toBe(false);
  });
});
