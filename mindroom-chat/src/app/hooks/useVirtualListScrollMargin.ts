import { RefObject, useCallback, useLayoutEffect, useState } from 'react';
import { useElementSizeObserver } from './useElementSizeObserver';

/** Keep virtual rows in viewport coordinates when headers or filters precede the list. */
export function useVirtualListScrollMargin(
  scrollRef: RefObject<HTMLElement>,
  listRef: RefObject<HTMLElement>
) {
  const [margin, setMargin] = useState(0);
  const measure = useCallback(() => {
    const scroll = scrollRef.current;
    const list = listRef.current;
    if (scroll && list) {
      setMargin(
        list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
      );
    }
  }, [scrollRef, listRef]);
  useLayoutEffect(measure);
  useElementSizeObserver(
    useCallback(() => scrollRef.current?.firstElementChild ?? null, [scrollRef]),
    measure
  );
  return margin;
}
