import React, { ComponentPropsWithoutRef, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as css from './ScrollableTable.css';

export function ScrollableTable({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const hintId = useId();

  useEffect(() => {
    const scroll = scrollRef.current;
    const table = tableRef.current;
    if (!scroll || !table) return undefined;

    const measure = () => setOverflowing(scroll.scrollWidth > scroll.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;

    // Watch the table too: streaming edits and loaded media can change its width.
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={css.Container}>
      {/* Native scroll areas need a tab stop for keyboard scrolling. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={scrollRef}
        className={css.ScrollArea}
        role={overflowing ? 'region' : undefined}
        aria-label={overflowing ? t('messageTable.label', 'Scrollable table') : undefined}
        aria-describedby={overflowing ? hintId : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        <table {...props} ref={tableRef} className={css.Table}>
          {children}
        </table>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
      {overflowing && (
        <div id={hintId} className={css.Hint}>
          <span aria-hidden="true">↔</span>
          {t('messageTable.scrollHint', 'Scroll horizontally')}
        </div>
      )}
    </div>
  );
}
