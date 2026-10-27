export type ThreadLedgerEvent = {
  getId: () => string | undefined;
};

/**
 * The reader's first visible row in the last committed thread render, with the
 * event list and row prices of that render. Index 0 is the thread root.
 */
export type ThreadLedgerAnchor = {
  threadId: string;
  eventId: string;
  index: number;
  events: readonly ThreadLedgerEvent[];
  priceRow: (eventId: string, index: number) => number;
};

export type ThreadLedgerFoldProbe =
  | 'threadPrependFoldAnchorFallback'
  | 'threadPrependFoldAnchorLost';

export type ThreadLedgerRenderPlan = {
  foldPx: number;
  probe?: ThreadLedgerFoldProbe;
};

type PlanThreadLedgerRenderArgs = {
  anchor: ThreadLedgerAnchor | undefined;
  eventIndexMap: ReadonlyMap<string, number>;
  priceRow: (eventId: string, index: number) => number;
  threadEvents: readonly ThreadLedgerEvent[];
  threadId?: string;
};

const sameRowsAbove = (
  previous: readonly ThreadLedgerEvent[],
  next: readonly ThreadLedgerEvent[],
  boundaryIndex: number
): boolean => {
  for (let index = 1; index < boundaryIndex; index += 1) {
    if (previous[index]?.getId() !== next[index]?.getId()) return false;
  }
  return true;
};

/**
 * Derive how far rows added above the reader push the reader down, so the
 * ledger can fold that height and keep the reader's rows in place. This holds
 * for every change to the thread's rows (Load Older, the opening history chain,
 * reconciled or recovered pages), like native scroll anchoring, which the
 * thread scroller disables. Pure: React may abandon this render plan, and the
 * caller applies it only from the commit phase.
 */
export const planThreadLedgerRender = ({
  anchor,
  eventIndexMap,
  priceRow,
  threadEvents,
  threadId,
}: PlanThreadLedgerRenderArgs): ThreadLedgerRenderPlan => {
  if (!anchor || !threadId || anchor.threadId !== threadId || anchor.events === threadEvents) {
    return { foldPx: 0 };
  }

  let previousIndex = anchor.index;
  let boundaryIndex = eventIndexMap.get(anchor.eventId);
  let probe: ThreadLedgerFoldProbe | undefined;
  if (boundaryIndex === undefined) {
    // The reader's row left; hold the nearest row above it that survived.
    for (previousIndex = anchor.index - 1; previousIndex >= 1; previousIndex -= 1) {
      const eventId = anchor.events[previousIndex]?.getId();
      boundaryIndex = eventId === undefined ? undefined : eventIndexMap.get(eventId);
      if (boundaryIndex !== undefined) break;
    }
    if (boundaryIndex === undefined) return { foldPx: 0, probe: 'threadPrependFoldAnchorLost' };
    probe = 'threadPrependFoldAnchorFallback';
  }
  const result = (foldPx: number): ThreadLedgerRenderPlan =>
    probe ? { foldPx, probe } : { foldPx };

  // The common case on a streaming thread: an edit or reply landed below.
  if (
    boundaryIndex === previousIndex &&
    sameRowsAbove(anchor.events, threadEvents, boundaryIndex)
  ) {
    return result(0);
  }

  const previousAbove = new Map<string, number>();
  for (let index = 1; index < previousIndex; index += 1) {
    const eventId = anchor.events[index]?.getId();
    if (eventId) previousAbove.set(eventId, index);
  }
  let foldPx = 0;
  for (let index = 1; index < boundaryIndex; index += 1) {
    const eventId = threadEvents[index]?.getId();
    if (eventId && !previousAbove.delete(eventId)) foldPx += priceRow(eventId, index);
  }
  // Rows that left the space above the reader take their committed height with them.
  previousAbove.forEach((index, eventId) => {
    foldPx -= anchor.priceRow(eventId, index);
  });
  return result(foldPx);
};
