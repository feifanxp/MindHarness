import { type RefObject, useLayoutEffect, useRef } from 'react';

const SCROLL_ANCHOR_ATTRIBUTE = 'data-scroll-anchor';
const SCROLL_ANCHOR_SELECTOR = `[${SCROLL_ANCHOR_ATTRIBUTE}]`;

type ScrollAnchor = {
  key: string;
  /** The row's top relative to the viewport's top when the list was left. */
  offset: number;
};

export type ScrollAnchorSnapshot = {
  scrollTop: number;
  /** The rows that were in view, so the list can reopen on them after rows reorder. */
  anchors: ScrollAnchor[];
};

/** Saved positions by memory key; the owner decides how long they live. */
export type ScrollAnchorMemory = Map<string, ScrollAnchorSnapshot>;

const getAnchorKey = (row: Element): string | null => row.getAttribute(SCROLL_ANCHOR_ATTRIBUTE);

// Rows render top to bottom, so the rows in view end at the first one below it.
const captureScrollAnchors = (view: HTMLElement): ScrollAnchorSnapshot => {
  const { top, bottom } = view.getBoundingClientRect();
  const anchors: ScrollAnchor[] = [];
  for (const row of view.querySelectorAll(SCROLL_ANCHOR_SELECTOR)) {
    const key = getAnchorKey(row);
    const rect = row.getBoundingClientRect();
    if (rect.top >= bottom) break;
    if (key !== null && rect.bottom > top) anchors.push({ key, offset: rect.top - top });
  }
  return { scrollTop: view.scrollTop, anchors };
};

type RowPlacement = {
  scrollTop: number;
  /** The saved rows that sit where they were at this scroll position. */
  rows: string[];
};

// Rows that kept their order agree on one scroll position. A row that moved,
// such as the thread just opened now sorting first, points somewhere else, so
// take the position most rows agree on, and on a tie the nearer one. Once a
// write has placed rows, later steps keep those rows, or none if they no
// longer agree; until then (no saved row rendered yet), each step votes.
const placeRows = (
  view: HTMLElement,
  snapshot: ScrollAnchorSnapshot,
  placedRows: string[]
): RowPlacement | undefined => {
  const fallback = { scrollTop: snapshot.scrollTop, rows: [] };
  if (snapshot.anchors.length === 0) return fallback;

  const offsets = new Map(snapshot.anchors.map((anchor) => [anchor.key, anchor.offset]));
  const viewTop = view.getBoundingClientRect().top;
  const candidates: RowPlacement[] = [];
  view.querySelectorAll(SCROLL_ANCHOR_SELECTOR).forEach((row) => {
    const key = getAnchorKey(row);
    const offset = key === null ? undefined : offsets.get(key);
    if (key === null || offset === undefined) return;
    const scrollTop = view.scrollTop + row.getBoundingClientRect().top - viewTop - offset;
    const candidate = candidates.find((entry) => Math.abs(entry.scrollTop - scrollTop) <= 1);
    if (candidate) candidate.rows.push(key);
    else candidates.push({ scrollTop, rows: [key] });
  });

  if (placedRows.length > 0) {
    return candidates.find((candidate) => placedRows.every((key) => candidate.rows.includes(key)));
  }
  const distance = (scrollTop: number) => Math.abs(scrollTop - snapshot.scrollTop);
  return candidates.reduce<RowPlacement>(
    (best, candidate) =>
      candidate.rows.length > best.rows.length ||
      (candidate.rows.length === best.rows.length &&
        distance(candidate.scrollTop) < distance(best.scrollTop))
        ? candidate
        : best,
    fallback
  );
};

const getRowKeys = (view: HTMLElement): string[] =>
  Array.from(view.querySelectorAll(SCROLL_ANCHOR_SELECTOR), getAnchorKey).filter(
    (key): key is string => key !== null
  );

// Rows rendering late or added and removed around the others keep the others'
// order; a row sorting past them changes it.
const keepsRowOrder = (before: string[], after: string[]): boolean => {
  const beforeKeys = new Set(before);
  const afterKeys = new Set(after);
  const kept = after.filter((key) => beforeKeys.has(key));
  return before.filter((key) => afterKeys.has(key)).every((key, index) => key === kept[index]);
};

type RestoreState = {
  memoryKey: string;
  /** Cleared once the restore is done following late layout. */
  snapshot?: ScrollAnchorSnapshot;
  /** The rows the last write put back in place. */
  placedRows: string[];
  /** Every row's key, in order, at the last write. */
  rowOrder: string[];
  lastAppliedScrollTop: number;
};

type ScrollAnchorMemoryOptions = {
  memory: ScrollAnchorMemory;
  /** Must stay the same for the component's lifetime. */
  memoryKey: string;
  /** The scroll container, rendered for the component's whole lifetime. */
  scrollRef: RefObject<HTMLElement>;
  /** The rows' container, so rows that render or resize late are followed. */
  contentRef: RefObject<HTMLElement>;
  /** False until the rows to restore against have rendered. */
  ready: boolean;
};

/**
 * A plain scroll list that reopens where the reader left it.
 * Rows carry a stable key in `data-scroll-anchor`. On unmount the list saves
 * the rows in view; the next mount scrolls so those rows sit where they were,
 * even if rows above them were added, removed, or reordered meanwhile.
 * Until the reader scrolls or the rows move apart or change order, it keeps
 * them there as late layout resizes the list.
 */
export function useScrollAnchorMemory({
  memory,
  memoryKey,
  scrollRef,
  contentRef,
  ready,
}: ScrollAnchorMemoryOptions): void {
  const restoreRef = useRef<RestoreState>();
  const readyRef = useRef(ready);
  useLayoutEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useLayoutEffect(() => {
    const view = scrollRef.current;
    if (!view || !ready) return undefined;
    if (restoreRef.current?.memoryKey !== memoryKey) {
      restoreRef.current = {
        memoryKey,
        snapshot: memory.get(memoryKey),
        placedRows: [],
        rowOrder: [],
        lastAppliedScrollTop: view.scrollTop,
      };
    }
    const state = restoreRef.current;

    let observer: ResizeObserver | undefined;
    const stopFollowing = () => {
      state.snapshot = undefined;
      observer?.disconnect();
      view.removeEventListener('scroll', handleScroll);
    };
    const handleScroll = () => {
      if (view.scrollTop !== state.lastAppliedScrollTop) stopFollowing();
    };
    const restore = () => {
      const { snapshot } = state;
      if (!snapshot) return;
      const placement = placeRows(view, snapshot, state.placedRows);
      const rowOrder = getRowKeys(view);
      // A reader who left at the top stays at the top, where rows that moved
      // up show; one who scrolled since the last write keeps their place.
      // Late layout moves the placed rows together (the header padding
      // settling, cards loading above). Rows that move apart or change order
      // are the list changing under the reader, such as a card leaving or a
      // thread sorting first, and stay where they land.
      if (
        snapshot.scrollTop <= 0 ||
        view.scrollTop !== state.lastAppliedScrollTop ||
        !placement ||
        !keepsRowOrder(state.rowOrder, rowOrder)
      ) {
        stopFollowing();
        return;
      }
      view.scrollTop = placement.scrollTop;
      state.placedRows = placement.rows;
      state.rowOrder = rowOrder;
      state.lastAppliedScrollTop = view.scrollTop;
    };
    restore();
    if (!state.snapshot) return undefined;

    observer = new ResizeObserver(restore);
    observer.observe(view);
    if (contentRef.current) observer.observe(contentRef.current);
    view.addEventListener('scroll', handleScroll);
    return () => {
      observer?.disconnect();
      view.removeEventListener('scroll', handleScroll);
    };
  }, [contentRef, memory, memoryKey, ready, scrollRef]);

  useLayoutEffect(() => {
    const view = scrollRef.current;
    return () => {
      // A list without its rows, before they render or after they all went,
      // keeps the position saved before it.
      if (view && readyRef.current) {
        memory.set(memoryKey, captureScrollAnchors(view));
      }
    };
  }, [memory, memoryKey, scrollRef]);
}
