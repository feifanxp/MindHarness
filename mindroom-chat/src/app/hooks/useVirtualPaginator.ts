import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { OnIntersectionCallback, useIntersectionObserver } from './useIntersectionObserver';
import { getScrollInfo, isIntersectingScrollView } from '../utils/dom';

const PAGINATOR_ANCHOR_ATTR = 'data-paginator-anchor';

export enum Direction {
  Backward = 'B',
  Forward = 'F',
}

export type ItemRange = {
  start: number;
  end: number;
};

export type ScrollToOptions = {
  offset?: number;
  align?: 'start' | 'center' | 'end';
  behavior?: 'auto' | 'instant' | 'smooth';
  stopInView?: boolean;
};

export type RetryPaginationOptions = {
  preserveAnchorIndex?: number;
};

/**
 * Scrolls the page to a specified element in the DOM.
 *
 * @param {HTMLElement} element - The DOM element to scroll to.
 * @param {ScrollToOptions} [opts] - Optional configuration for the scroll behavior (e.g., smooth scrolling, alignment).
 * @returns {boolean} - Returns `true` if the scroll was successful, otherwise returns `false`.
 */
export type ScrollToElement = (element: HTMLElement, opts?: ScrollToOptions) => boolean;

/**
 * Scrolls the page to an item at the specified index within a scrollable container.
 *
 * @param {number} index - The index of the item to scroll to.
 * @param {ScrollToOptions} [opts] - Optional configuration for the scroll behavior (e.g., smooth scrolling, alignment).
 * @returns {boolean} - Returns `true` if the scroll was successful, otherwise returns `false`.
 */
export type ScrollToItem = (index: number, opts?: ScrollToOptions) => boolean;

type HandleObserveAnchor = (element: HTMLElement | null) => void;

type VirtualPaginatorOptions<TScrollElement extends HTMLElement> = {
  count: number;
  limit: number;
  range: ItemRange;
  onRangeChange: (range: ItemRange) => void;
  getScrollElement: () => TScrollElement | null;
  getItemElement: (index: number) => HTMLElement | undefined;
  onEnd?: (back: boolean) => void;
  shouldSuppressPagination?: () => boolean;
  // True means an active owner accepted the retry; false preserves dispatch.
  deferAutomaticPagination?: (retry: () => boolean) => boolean;
  // The consumer owns backward-prepend scroll compensation (MindRoom
  // offset ledger): skip this hook's own restore capture for
  // paginate(Backward), or the anchor gets compensated twice — the
  // hook's scrollBy(delta) lands before the consumer's margin effect
  // in the same commit and reads the pre-margin layout (CodeRabbit on
  // PR #91). Forward-drop restores are unaffected; the ledger only
  // folds start-decreases.
  externalBackwardScrollRestore?: boolean;
};

type VirtualPaginator = {
  getItems: () => number[];
  scrollToElement: ScrollToElement;
  scrollToItem: ScrollToItem;
  retryPagination: (opts?: RetryPaginationOptions) => void;
  observeBackAnchor: HandleObserveAnchor;
  observeFrontAnchor: HandleObserveAnchor;
};

const generateItems = (range: ItemRange) => {
  const items: number[] = [];
  for (let i = range.start; i < range.end; i += 1) {
    items.push(i);
  }

  return items;
};

const getDropIndex = (
  scrollEl: HTMLElement,
  range: ItemRange,
  dropDirection: Direction,
  getItemElement: (index: number) => HTMLElement | undefined,
  pageThreshold = 1
): number | undefined => {
  const fromBackward = dropDirection === Direction.Backward;
  const items = fromBackward ? generateItems(range) : generateItems(range).reverse();

  const { viewHeight, top, height } = getScrollInfo(scrollEl);
  const { offsetTop: sOffsetTop } = scrollEl;
  const bottom = top + viewHeight;
  const dropEdgePx = fromBackward
    ? Math.max(top - viewHeight * pageThreshold, 0)
    : Math.min(bottom + viewHeight * pageThreshold, height);
  if (dropEdgePx === 0 || dropEdgePx === height) return undefined;

  let dropIndex: number | undefined;

  items.find((item) => {
    const el = getItemElement(item);
    if (!el) {
      dropIndex = item;
      return false;
    }
    const { clientHeight } = el;
    const offsetTop = el.offsetTop - sOffsetTop;
    const offsetBottom = offsetTop + clientHeight;
    const isInView = fromBackward ? offsetBottom > dropEdgePx : offsetTop < dropEdgePx;
    if (isInView) return true;
    dropIndex = item;
    return false;
  });

  return dropIndex;
};

type RestoreAnchorData = [number | undefined, HTMLElement | undefined];
const getRestoreAnchor = (
  range: ItemRange,
  getItemElement: (index: number) => HTMLElement | undefined,
  direction: Direction
): RestoreAnchorData => {
  let scrollAnchorEl: HTMLElement | undefined;
  const scrollAnchorItem = (
    direction === Direction.Backward ? generateItems(range) : generateItems(range).reverse()
  ).find((i) => {
    const el = getItemElement(i);
    if (el) {
      scrollAnchorEl = el;
      return true;
    }
    return false;
  });
  return [scrollAnchorItem, scrollAnchorEl];
};

const getRestoreScrollData = (restoreAnchorData: RestoreAnchorData) => {
  const [anchorItem, anchorElement] = restoreAnchorData;
  if (anchorItem === undefined || !anchorElement) {
    return undefined;
  }
  return {
    anchorItem,
    anchorBcrTop: anchorElement.getBoundingClientRect().top,
  };
};

// Explicit jumps use the area left visible by sticky headers and footers.
// Pagination still observes the physical viewport through the shared DOM helpers.
const getScrollTargetBounds = (scrollElement: HTMLElement) => {
  const rect = scrollElement.getBoundingClientRect();
  const style = getComputedStyle(scrollElement);
  const top = rect.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
  const bottom = rect.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
  return { top, bottom, height: Math.max(0, bottom - top) };
};

const getDesiredElementTop = (
  scrollElement: HTMLElement,
  element: HTMLElement,
  opts?: ScrollToOptions
): number => {
  const containerRect = getScrollTargetBounds(scrollElement);
  const elementRect = element.getBoundingClientRect();
  let desiredTop = containerRect.top;

  if (opts?.align === 'center' && elementRect.height < containerRect.height) {
    desiredTop = containerRect.top + containerRect.height / 2 - elementRect.height / 2;
  } else if (opts?.align === 'end' && elementRect.height < containerRect.height) {
    desiredTop = containerRect.bottom - elementRect.height;
  }

  return desiredTop + (opts?.offset ?? 0);
};

const useObserveAnchorHandle = (
  intersectionObserver: ReturnType<typeof useIntersectionObserver>,
  anchorType: Direction
): HandleObserveAnchor =>
  useMemo<HandleObserveAnchor>(() => {
    let anchor: HTMLElement | null = null;
    return (element) => {
      if (element === anchor) return;
      if (anchor) intersectionObserver?.unobserve(anchor);
      if (!element) return;
      anchor = element;
      element.setAttribute(PAGINATOR_ANCHOR_ATTR, anchorType);
      intersectionObserver?.observe(element);
    };
  }, [intersectionObserver, anchorType]);

export const useVirtualPaginator = <TScrollElement extends HTMLElement>(
  options: VirtualPaginatorOptions<TScrollElement>
): VirtualPaginator => {
  const {
    count,
    limit,
    range,
    onRangeChange,
    getScrollElement,
    getItemElement,
    onEnd,
    shouldSuppressPagination,
    deferAutomaticPagination,
    externalBackwardScrollRestore,
  } = options;

  const initialRenderRef = useRef(true);

  const restoreScrollRef = useRef<{
    anchorBcrTop: number;
    anchorItem: number;
  }>();

  const scrollToItemRef = useRef<{
    index: number;
    opts?: ScrollToOptions;
  }>();

  const propRef = useRef({
    range,
    limit,
    count,
  });
  if (propRef.current.count !== count) {
    // Clear restoreScrollRef on count change
    // As restoreScrollRef.current.anchorItem might changes
    restoreScrollRef.current = undefined;
  }
  propRef.current = {
    range,
    count,
    limit,
  };

  const getItems = useMemo(() => {
    const items = generateItems(range);
    return () => items;
  }, [range]);

  const scrollToElement = useCallback<ScrollToElement>(
    (element, opts) => {
      const scrollElement = getScrollElement();
      if (!scrollElement) return false;

      if (opts?.stopInView) {
        const bounds = getScrollTargetBounds(scrollElement);
        const elementRect = element.getBoundingClientRect();
        if (elementRect.top >= bounds.top && elementRect.bottom <= bounds.bottom) return false;
      }

      const delta =
        element.getBoundingClientRect().top - getDesiredElementTop(scrollElement, element, opts);

      scrollElement.scrollBy({
        top: delta,
        behavior: opts?.behavior,
      });

      requestAnimationFrame(() => {
        const error =
          element.getBoundingClientRect().top - getDesiredElementTop(scrollElement, element, opts);
        if (Math.abs(error) > 2) {
          // At scroll boundaries, correction in the clamped direction is impossible
          // and would cause overshoot if the element position shifts in the next frame.
          const { scrollTop, scrollHeight, clientHeight } = scrollElement;
          const atTop = scrollTop <= 0;
          const atBottom = scrollTop >= scrollHeight - clientHeight;
          if ((atTop && error < 0) || (atBottom && error > 0)) {
            return;
          }
          scrollElement.scrollBy({
            top: error,
            behavior: 'instant',
          });
        }
      });
      return true;
    },
    [getScrollElement]
  );

  const scrollToItem = useCallback<ScrollToItem>(
    (index, opts) => {
      const { range: currentRange, limit: currentLimit, count: currentCount } = propRef.current;

      if (index < 0 || index >= currentCount) return false;
      // index is not in range change range
      // and trigger scrollToItem in layoutEffect hook
      if (index < currentRange.start || index >= currentRange.end) {
        onRangeChange({
          start: Math.max(index - currentLimit, 0),
          end: Math.min(index + currentLimit, currentCount),
        });
        scrollToItemRef.current = {
          index,
          opts,
        };
        return true;
      }

      // find target or it's previous rendered element to scroll to
      const targetItems = generateItems({ start: currentRange.start, end: index + 1 });
      const targetItem = targetItems.reverse().find((i) => getItemElement(i) !== undefined);
      const itemElement = targetItem && getItemElement(targetItem);

      if (!itemElement) {
        const scrollElement = getScrollElement();
        scrollElement?.scrollTo({
          top: opts?.offset ?? 0,
          behavior: opts?.behavior,
        });
        return true;
      }
      return scrollToElement(itemElement, opts);
    },
    [getScrollElement, scrollToElement, getItemElement, onRangeChange]
  );

  const paginate = useCallback(
    (direction: Direction, opts?: RetryPaginationOptions) => {
      if (shouldSuppressPagination?.()) return;

      const scrollEl = getScrollElement();
      const { range: currentRange, limit: currentLimit, count: currentCount } = propRef.current;
      let { start, end } = currentRange;
      const preserveAnchorIndex = opts?.preserveAnchorIndex;
      const getRestoreAnchorData = (fallbackDirection: Direction) => {
        if (preserveAnchorIndex !== undefined) {
          const preserveAnchorElement = getItemElement(preserveAnchorIndex);
          if (preserveAnchorElement) {
            return [preserveAnchorIndex, preserveAnchorElement] as RestoreAnchorData;
          }
        }

        return getRestoreAnchor({ start, end }, getItemElement, fallbackDirection);
      };

      if (direction === Direction.Backward) {
        restoreScrollRef.current = undefined;
        if (start === 0) {
          onEnd?.(true);
          return;
        }
        if (scrollEl && !externalBackwardScrollRestore) {
          restoreScrollRef.current = getRestoreScrollData(getRestoreAnchorData(Direction.Backward));
        }
        if (scrollEl) {
          end = getDropIndex(scrollEl, currentRange, Direction.Forward, getItemElement, 2) ?? end;
        }
        start = Math.max(start - currentLimit, 0);
      }

      if (direction === Direction.Forward) {
        restoreScrollRef.current = undefined;
        if (end === currentCount) {
          onEnd?.(false);
          return;
        }
        if (scrollEl) {
          restoreScrollRef.current = getRestoreScrollData(getRestoreAnchorData(Direction.Forward));
        }
        end = Math.min(end + currentLimit, currentCount);
        if (scrollEl) {
          start =
            getDropIndex(scrollEl, currentRange, Direction.Backward, getItemElement, 2) ?? start;
        }
      }

      onRangeChange({
        start,
        end,
      });
    },
    [
      externalBackwardScrollRestore,
      getScrollElement,
      getItemElement,
      onEnd,
      onRangeChange,
      shouldSuppressPagination,
    ]
  );

  const retryPagination = useCallback(
    (opts?: RetryPaginationOptions) => {
      const scrollElement = getScrollElement();
      if (!scrollElement) return false;

      const backAnchor = scrollElement.querySelector(
        `[${PAGINATOR_ANCHOR_ATTR}="${Direction.Backward}"]`
      ) as HTMLElement | null;
      const frontAnchor = scrollElement.querySelector(
        `[${PAGINATOR_ANCHOR_ATTR}="${Direction.Forward}"]`
      ) as HTMLElement | null;

      if (backAnchor && isIntersectingScrollView(scrollElement, backAnchor)) {
        paginate(Direction.Backward, opts);
        return true;
      }
      if (frontAnchor && isIntersectingScrollView(scrollElement, frontAnchor)) {
        paginate(Direction.Forward, opts);
        return true;
      }
      return false;
    },
    [getScrollElement, paginate]
  );

  const retryAutomaticPagination = useCallback(() => {
    if (!deferAutomaticPagination?.(retryPagination)) retryPagination();
  }, [deferAutomaticPagination, retryPagination]);

  const handlePaginatorElIntersection: OnIntersectionCallback = useCallback(
    (entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        deferAutomaticPagination?.(retryPagination)
      )
        return;
      const anchorB = entries.find(
        (entry) => entry.target.getAttribute(PAGINATOR_ANCHOR_ATTR) === Direction.Backward
      );
      if (anchorB?.isIntersecting) {
        paginate(Direction.Backward);
      }
      const anchorF = entries.find(
        (entry) => entry.target.getAttribute(PAGINATOR_ANCHOR_ATTR) === Direction.Forward
      );
      if (anchorF?.isIntersecting) {
        paginate(Direction.Forward);
      }
    },
    [deferAutomaticPagination, paginate, retryPagination]
  );

  const intersectionObserver = useIntersectionObserver(
    handlePaginatorElIntersection,
    useCallback(
      () => ({
        root: getScrollElement(),
      }),
      [getScrollElement]
    )
  );

  const observeBackAnchor = useObserveAnchorHandle(intersectionObserver, Direction.Backward);
  const observeFrontAnchor = useObserveAnchorHandle(intersectionObserver, Direction.Forward);

  // Restore scroll when local pagination.
  // restoreScrollRef.current only gets set
  // when paginate() changes range itself
  useLayoutEffect(() => {
    const scrollEl = getScrollElement();
    if (!restoreScrollRef.current || !scrollEl) return;
    const { anchorBcrTop: anchorTopBefore, anchorItem } = restoreScrollRef.current;
    const anchorEl = getItemElement(anchorItem);

    if (!anchorEl) return;
    const anchorTopAfter = anchorEl.getBoundingClientRect().top;
    const delta = anchorTopAfter - anchorTopBefore;

    scrollEl.scrollBy({
      top: delta,
      behavior: 'instant',
    });
    restoreScrollRef.current = undefined;
  }, [range, getScrollElement, getItemElement]);

  // When scrollToItem index was not in range.
  // Scroll to item after range changes.
  useLayoutEffect(() => {
    if (scrollToItemRef.current === undefined) return;
    const { index, opts } = scrollToItemRef.current;
    scrollToItem(index, {
      ...opts,
      behavior: 'instant',
    });
    scrollToItemRef.current = undefined;
  }, [range, scrollToItem]);

  // Continue pagination to fill view height with scroll items
  // check if pagination anchor are in visible view height
  // and trigger pagination
  useEffect(() => {
    if (initialRenderRef.current) {
      // Do not trigger pagination on initial render
      // anchor intersection observable will trigger pagination on mount
      initialRenderRef.current = false;
      return;
    }
    retryAutomaticPagination();
  }, [range, retryAutomaticPagination]);

  return {
    getItems,
    scrollToItem,
    scrollToElement,
    retryPagination,
    observeBackAnchor,
    observeFrontAnchor,
  };
};
