import { useTranslation } from 'react-i18next';
import React, { MouseEvent, RefObject, useCallback, useEffect, useState } from 'react';
import {
  TIMELINE_MINIMAP_MIN_ITEMS,
  TimelineMinimapItem,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapTopPercent,
} from './timelineMinimapViewModel';
import * as css from './TimelineMinimap.css';

const resolveStripClass = (distance: number | null): string => {
  if (distance === 0) return css.MinimapStrip.Active;
  if (distance === 1) return css.MinimapStrip.Close;
  if (distance === 2) return css.MinimapStrip.Near;
  return css.MinimapStrip.Rest;
};

/**
 * Keeps each stripe's `data-in-view` flag in sync with the scroll viewport
 * without re-rendering: stripes register DOM nodes in `stripMap` and this
 * hook mutates their dataset on scroll frames.
 */
export const useTimelineMinimapInView = (
  scrollRef: RefObject<HTMLElement>,
  items: readonly TimelineMinimapItem[],
  stripMap: Map<string, HTMLSpanElement>,
  enabled: boolean
): void => {
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!enabled || !scrollElement || items.length < TIMELINE_MINIMAP_MIN_ITEMS) return undefined;

    const itemIds = new Set(items.map((item) => item.id));
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerRect = scrollElement.getBoundingClientRect();
      // Single DOM pass per frame: anchor each stripe at its message's top
      // edge and extend its range down to the next stripe's anchor, so
      // scrolling through a tall agent reply still highlights the question
      // that reply belongs to.
      const anchors: { id: string; top: number }[] = [];
      scrollElement.querySelectorAll<HTMLElement>('[data-message-id]').forEach((element) => {
        const messageId = element.getAttribute('data-message-id');
        if (messageId && itemIds.has(messageId)) {
          anchors.push({ id: messageId, top: element.getBoundingClientRect().top });
        }
      });
      anchors.sort((a, b) => a.top - b.top);
      const inViewIds = new Set<string>();
      anchors.forEach((anchor, index) => {
        const rangeEnd =
          index + 1 < anchors.length ? anchors[index + 1].top : Number.POSITIVE_INFINITY;
        if (rangeEnd > containerRect.top && anchor.top < containerRect.bottom) {
          inViewIds.add(anchor.id);
        }
      });
      items.forEach((item) => {
        const strip = stripMap.get(item.id);
        if (!strip) return;
        strip.dataset.inView = inViewIds.has(item.id) ? 'true' : 'false';
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    schedule();
    scrollElement.addEventListener('scroll', schedule, { passive: true });
    // Layout can shift without a scroll event (window resize, collapsibles
    // expanding, media loading), so track container and content size too.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(scrollElement);
      if (scrollElement.firstElementChild) resizeObserver.observe(scrollElement.firstElementChild);
    }
    return () => {
      scrollElement.removeEventListener('scroll', schedule);
      resizeObserver?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [scrollRef, items, stripMap, enabled]);
};

type TimelineMinimapProps = {
  items: readonly TimelineMinimapItem[];
  stripMap: Map<string, HTMLSpanElement>;
  onSelect: (item: TimelineMinimapItem) => void;
};

export function TimelineMinimap({ items, stripMap, onSelect }: TimelineMinimapProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolvedActiveIndex === null ? null : items[resolvedActiveIndex] ?? null;
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTimelineMinimapTopPercent(resolvedActiveIndex, items.length);
  let activeTooltipTranslate = '-50%';
  if (resolvedActiveIndex === 0) activeTooltipTranslate = '0%';
  else if (resolvedActiveIndex === items.length - 1) activeTooltipTranslate = '-100%';

  const resolveActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return resolveTimelineMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length]
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length]
  );

  if (items.length < TIMELINE_MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div className={css.MinimapContainer} data-testid="timeline-minimap">
      <div className={css.MinimapBody}>
        <button
          type="button"
          className={css.MinimapRail}
          style={{ height: resolveTimelineMinimapHeightStyle(items.length) }}
          role="slider"
          aria-label={t('mindroomUi.threads.timelineMinimap.jumpToMessage')}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={items.length - 1}
          aria-valuenow={resolvedActiveIndex ?? undefined}
          aria-valuetext={
            activeItem
              ? [activeItem.userText ?? 'Message', activeItem.agentText].filter(Boolean).join(' — ')
              : 'Message'
          }
          onBlur={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onMouseMove={(event) => setActiveIndex(resolveActiveIndexFromPointer(event))}
          onMouseLeave={() => setActiveIndex(null)}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem = nextIndex === null ? null : items[nextIndex] ?? null;
            if (nextItem) {
              onSelect(nextItem);
            }
            event.currentTarget.blur();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveActiveIndex(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveActiveIndex(-1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (activeItem) {
                onSelect(activeItem);
              }
            }
          }}
        >
          {items.map((item, index) => {
            const distance =
              resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
            return (
              <span
                key={item.id}
                aria-hidden="true"
                className={resolveStripClass(distance)}
                data-in-view="false"
                data-minimap-strip
                ref={(node) => {
                  if (node) {
                    stripMap.set(item.id, node);
                  } else {
                    stripMap.delete(item.id);
                  }
                }}
                style={{ top: `${resolveTimelineMinimapTopPercent(index, items.length)}%` }}
              />
            );
          })}
          {activeItem && (
            <span
              className={css.MinimapPreviewCard}
              style={{
                top: `${activeTopPercent}%`,
                transform: `translateY(${activeTooltipTranslate})`,
              }}
            >
              <span className={css.MinimapPreviewTitle}>
                {activeItem.userText ?? t('mindroomUi.threads.timelineMinimap.message')}
              </span>
              {activeItem.agentText && (
                <span className={css.MinimapPreviewBody}>{activeItem.agentText}</span>
              )}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
