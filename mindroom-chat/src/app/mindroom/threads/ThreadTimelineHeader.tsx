import React, { ReactNode, RefObject, useEffect, useRef } from 'react';
import { config } from 'folds';
import { headerInset } from './RoomOverlay.css';

/** Keep the banner in the scrollable content so messages can pass behind its glass. */
export function ThreadTimelineHeader({
  children,
  expansionControl,
  onResize,
  scrollRef,
}: {
  children: ReactNode;
  expansionControl: ReactNode;
  /** Gets each height change, and the offset before it, ahead of the layout that moves the rows. */
  onResize: (deltaPx: number, scrollTop: number) => void;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The scroll container is an ancestor; its ref attaches after child layout effects.
  useEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!header || !content || !scroll) return undefined;
    const previousPadding = scroll.style.scrollPaddingTop;
    let height: number | undefined;
    const updatePadding = () => {
      // The banner resizes inside a header that keeps its last height, so the
      // rows move only here, before a layout. Read the offset first: at the
      // bottom, a layout of the shrunk header clamps it.
      const next = content.offsetHeight;
      const { scrollTop } = scroll;
      header.style.height = `${next}px`;
      if (height !== undefined && next !== height) onResize(next - height, scrollTop);
      height = next;
      scroll.style.scrollPaddingTop = `calc(${headerInset} + ${next}px)`;
      scroll.parentElement?.style.setProperty('--room-thread-header-height', `${next}px`);
    };
    updatePadding();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // The inset resizes the shallower scrollbar track. Write next frame so
      // its observer can run without violating ResizeObserver's depth ordering.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePadding();
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scroll.style.scrollPaddingTop = previousPadding;
      scroll.parentElement?.style.removeProperty('--room-thread-header-height');
    };
  }, [onResize, scrollRef]);

  return (
    <div
      ref={headerRef}
      style={{
        position: 'sticky',
        top: headerInset,
        zIndex: 3,
        flexShrink: 0,
        pointerEvents: 'none',
      }}
    >
      <div ref={contentRef} style={{ display: 'flow-root', paddingBottom: config.space.S600 }}>
        {children}
        <div style={{ position: 'relative', pointerEvents: 'auto' }}>{expansionControl}</div>
      </div>
    </div>
  );
}
