import React, { RefObject, useCallback, useState } from 'react';
import { Box, as } from 'folds';
import classNames from 'classnames';
import * as css from './style.css';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';

export const ScrollTopContainer = as<
  'div',
  {
    scrollRef?: RefObject<HTMLElement>;
    anchorRef: RefObject<HTMLElement>;
    onVisibilityChange?: (onTop: boolean) => void;
    respectScrollPadding?: boolean;
  }
>(
  (
    { className, scrollRef, anchorRef, onVisibilityChange, respectScrollPadding, ...props },
    ref
  ) => {
    const [onTop, setOnTop] = useState(true);

    useIntersectionObserver(
      useCallback(
        (intersectionEntries) => {
          if (!anchorRef.current) return;
          const entry = getIntersectionObserverEntry(anchorRef.current, intersectionEntries);
          if (entry) {
            setOnTop(entry.isIntersecting);
            onVisibilityChange?.(entry.isIntersecting);
          }
        },
        [anchorRef, onVisibilityChange]
      ),
      useCallback(() => {
        const root = scrollRef?.current;
        const inset =
          respectScrollPadding && root
            ? parseFloat(getComputedStyle(root).scrollPaddingBlockStart) || 0
            : 0;
        return { root, rootMargin: `-${inset}px 0px 0px 0px` };
      }, [scrollRef, respectScrollPadding]),
      useCallback(() => anchorRef.current, [anchorRef])
    );

    if (onTop) return null;

    return <Box className={classNames(css.ScrollTopContainer, className)} {...props} ref={ref} />;
  }
);
