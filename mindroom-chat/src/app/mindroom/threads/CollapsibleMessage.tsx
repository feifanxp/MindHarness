import React, {
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useId,
} from 'react';
import { countCacheProbe } from './cacheProbe';
import * as css from './CollapsibleMessage.css';

const MAX_HEIGHT = '11em';

// The owning timeline's expand/collapse-all baseline, scoped to that timeline
// instance. Newly mounted rows read it render-purely as their initial expanded
// state (virtualized timelines mount rows lazily), and mounted rows follow its
// changes in an effect, one commit after the timeline captures its reader
// anchor. `undefined` means "no override — use the per-message default".
export const ExpandAllInitContext = React.createContext<boolean | undefined>(undefined);

// Manual expansion is user preference, unlike the module-level overflow
// verdict cache below (which is only a measurement warm-start hint). Keep it
// in a room/thread timeline-owned Map so virtualization remounts can reuse it
// without leaking UI state across navigation.
export const ManualExpansionStateContext = React.createContext<Map<string, boolean> | undefined>(
  undefined
);
const ExpansionLayoutChangeContext = React.createContext<(() => void) | undefined>(undefined);
export const MANUAL_EXPANSION_STATE_LIMIT = 4000;

export const rememberManualExpansionState = (
  state: Map<string, boolean>,
  key: string,
  expanded: boolean,
  limit = MANUAL_EXPANSION_STATE_LIMIT
) => {
  // Refresh existing keys so oldest-entry eviction retains recently-used rows.
  state.delete(key);
  state.set(key, expanded);
  while (state.size > limit) {
    const oldestKey = state.keys().next().value;
    if (oldestKey === undefined) break;
    state.delete(oldestKey);
  }
};

export function CollapsibleMessageStateProvider({
  children,
  expandAllInit,
  manualExpansionState,
  onExpansionLayoutChange,
}: {
  children: ReactNode;
  expandAllInit: boolean | undefined;
  manualExpansionState: Map<string, boolean>;
  onExpansionLayoutChange?: () => void;
}) {
  return (
    <ManualExpansionStateContext.Provider value={manualExpansionState}>
      <ExpansionLayoutChangeContext.Provider value={onExpansionLayoutChange}>
        <ExpandAllInitContext.Provider value={expandAllInit}>
          {children}
        </ExpandAllInitContext.Provider>
      </ExpansionLayoutChangeContext.Provider>
    </ManualExpansionStateContext.Provider>
  );
}

const getCollapsedMaxHeight = (el: HTMLDivElement): number | undefined => {
  if (MAX_HEIGHT.endsWith('px')) {
    const pixelHeight = Number.parseFloat(MAX_HEIGHT);
    return Number.isFinite(pixelHeight) ? pixelHeight : undefined;
  }

  if (!MAX_HEIGHT.endsWith('em') || typeof globalThis.getComputedStyle !== 'function') {
    return undefined;
  }

  const fontSize = Number.parseFloat(globalThis.getComputedStyle(el).fontSize);
  if (!Number.isFinite(fontSize)) return undefined;

  return Number.parseFloat(MAX_HEIGHT) * fontSize;
};

/**
 * Returns whether the element's content overflows the collapsed max-height.
 * Returns `null` when the element hasn't been laid out yet (scrollHeight === 0),
 * so callers can preserve their current assumption instead of recording a
 * false negative.
 */
const isContentOverflowing = (el: HTMLDivElement, expanded: boolean): boolean | null => {
  const { scrollHeight } = el;
  if (scrollHeight === 0) return null;

  const collapsedMaxHeight = getCollapsedMaxHeight(el);
  if (collapsedMaxHeight !== undefined) {
    return scrollHeight > collapsedMaxHeight + 1;
  }

  return !expanded && scrollHeight > el.clientHeight + 1;
};

// Task #127: remembered overflow verdicts, keyed by measurementKey.
//
// `overflowing` used to initialize to `true` on EVERY mount, so every
// virtualized remount of a short row rendered capped-with-banner first
// and shrank one layout pass later — a two-pass height per remount.
// Each pass makes the virtualizer re-measure and correct scrollTop for
// rows above the viewport; in regions dense with collapsible rows the
// corrections shift the virtual window, remounting neighbours, whose
// own two-pass heights correct back — the observed rapid oscillation
// between two positions. The same flip firing from the viewport-entry
// IntersectionObserver re-check lands mid-scroll and kills iOS flick
// momentum with a visible small jump.
//
// With the verdict cached, a remounting row renders its final height
// in ONE pass, and viewport-entry re-checks confirm instead of flip.
// Only the first-ever encounter of a row can still two-pass (initial
// guess stays `true`, correct for genuinely-overflowing content).
// Values are booleans keyed by string — no element/event retention.
//
// The cache is a WARM-START HINT for the initial render only; it is
// never the source of truth. Every mount still runs the layout check,
// the ResizeObserver, and the viewport-entry IntersectionObserver,
// each of which re-measures the real DOM and calls
// `applyOverflowVerdict` — so a stale hint (e.g. the same message
// rendered at a different container width) self-corrects within a
// layout pass and updates the cache. `measurementKey` already varies
// by event id, redaction state, edit event id, and collapse mode
// (see getCollapsibleMessageMeasurementKey), so content edits and
// redactions produce a fresh key rather than a stale hit.
const overflowVerdictCache = new Map<string, boolean>();
const OVERFLOW_VERDICT_CACHE_LIMIT = 4000;
const rememberOverflowVerdict = (measurementKey: string | undefined, verdict: boolean) => {
  if (measurementKey === undefined) return;
  // Bounded FIFO eviction rather than a full clear: dropping the whole
  // cache at the limit would make every currently-virtualized row lose
  // its hint at once (a re-measure cliff). Map preserves insertion
  // order, so deleting from the front evicts the oldest keys — the ones
  // least likely to be on screen — while keeping recent verdicts warm.
  if (overflowVerdictCache.size >= OVERFLOW_VERDICT_CACHE_LIMIT) {
    const evictTo = Math.floor(OVERFLOW_VERDICT_CACHE_LIMIT * 0.75);
    for (const key of overflowVerdictCache.keys()) {
      if (overflowVerdictCache.size <= evictTo) break;
      overflowVerdictCache.delete(key);
    }
  }
  overflowVerdictCache.set(measurementKey, verdict);
};

export type CollapsibleMessageCollapseMode = 'default' | 'always-expanded' | 'initially-expanded';

type CollapsibleMessageProps = {
  children: ReactNode | ((state: CollapsibleMessageRenderState) => ReactNode);
  collapseMode?: CollapsibleMessageCollapseMode;
  expansionKey?: string;
  forceOverflowing?: boolean;
  measurementKey?: string;
  onInitialExpandConsumed?: () => void;
};

export type CollapsibleMessageRenderState = {
  expanded: boolean;
  loadFullContent: boolean;
};

export function CollapsibleMessage({
  children,
  collapseMode = 'default',
  expansionKey,
  forceOverflowing = false,
  measurementKey,
  onInitialExpandConsumed,
}: CollapsibleMessageProps) {
  const isExempt = collapseMode === 'always-expanded';
  const contentRef = useRef<HTMLDivElement>(null);
  const measurementKeyRef = useRef(measurementKey);
  const contentId = useId();
  const initialExpandConsumedRef = useRef(onInitialExpandConsumed);
  const previousCollapseModeRef = useRef<CollapsibleMessageCollapseMode | undefined>(undefined);
  const expandAllInit = useContext(ExpandAllInitContext);
  const onExpansionLayoutChange = useContext(ExpansionLayoutChangeContext);
  const previousExpandAllInitRef = useRef(expandAllInit);
  const manualExpansionState = useContext(ManualExpansionStateContext);
  const [overflowing, setOverflowing] = useState(() => {
    // forceOverflowing is a prop-driven override (lazily-hydrated
    // collapsed content) and must win over any cached verdict — a row
    // that previously cached `false` must still show the affordance
    // when forced. Not cached: it is not a measured verdict.
    if (forceOverflowing) return true;
    if (measurementKey !== undefined) {
      const remembered = overflowVerdictCache.get(measurementKey);
      if (remembered !== undefined) return remembered;
    }
    return true;
  });
  useLayoutEffect(() => {
    measurementKeyRef.current = measurementKey;
  }, [measurementKey]);
  const applyOverflowVerdict = useCallback((verdict: boolean) => {
    countCacheProbe(verdict ? 'collapsibleVerdictOverflowing' : 'collapsibleVerdictNotOverflowing');
    rememberOverflowVerdict(measurementKeyRef.current, verdict);
    setOverflowing(verdict);
  }, []);
  const [expanded, setExpanded] = useState(() => {
    // Live-expand-once rows must mount expanded even under an active
    // collapse-all override; the mount effect would correct this anyway, but
    // only after paint (a visible collapsed flash on virtualized mounts).
    if (collapseMode === 'initially-expanded') {
      return true;
    }
    if (!isExempt && expansionKey !== undefined) {
      const remembered = manualExpansionState?.get(expansionKey);
      if (remembered !== undefined) return remembered;
    }
    if (!isExempt && expandAllInit !== undefined) {
      return expandAllInit;
    }
    return collapseMode !== 'default';
  });
  const hasRenderFunctionChildren = typeof children === 'function';
  const effectiveExpanded = isExempt || expanded;
  const previousEffectiveExpandedRef = useRef(effectiveExpanded);
  const [loadFullContent, setLoadFullContent] = useState(
    () =>
      !hasRenderFunctionChildren || effectiveExpanded || typeof IntersectionObserver === 'undefined'
  );

  initialExpandConsumedRef.current = onInitialExpandConsumed;

  const checkOverflow = useCallback(() => {
    if (isExempt) return;
    if (forceOverflowing) {
      // Prop-driven override, not a detected verdict — not cached.
      setOverflowing(true);
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    const result = isContentOverflowing(el, expanded);
    if (result !== null) {
      applyOverflowVerdict(result);
    }
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt]);

  useEffect(() => {
    if (
      collapseMode === 'initially-expanded' &&
      previousCollapseModeRef.current !== 'initially-expanded'
    ) {
      setExpanded(true);
      initialExpandConsumedRef.current?.();
    }
    previousCollapseModeRef.current = collapseMode;
  }, [collapseMode]);

  useEffect(() => {
    if (previousExpandAllInitRef.current === expandAllInit) return;
    previousExpandAllInitRef.current = expandAllInit;
    if (isExempt || collapseMode === 'initially-expanded' || expandAllInit === undefined) return;
    if (expansionKey !== undefined && manualExpansionState?.has(expansionKey)) return;
    setExpanded(expandAllInit);
  }, [collapseMode, expandAllInit, expansionKey, isExempt, manualExpansionState]);

  useLayoutEffect(() => {
    if (previousEffectiveExpandedRef.current === effectiveExpanded) return;
    previousEffectiveExpandedRef.current = effectiveExpanded;
    onExpansionLayoutChange?.();
  }, [effectiveExpanded, onExpansionLayoutChange]);

  // Full long-text sidecars should load before the user expands a visible
  // row, but not for virtualizer overscan rows that never enter the viewport.
  // Once enabled, keep the full content mounted across collapse/expand cycles.
  useEffect(() => {
    if (!hasRenderFunctionChildren || loadFullContent) return undefined;
    if (effectiveExpanded) {
      setLoadFullContent(true);
      return undefined;
    }

    const el = contentRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setLoadFullContent(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setLoadFullContent(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [effectiveExpanded, hasRenderFunctionChildren, loadFullContent]);

  // Expanded streaming rows have natural height. Let ResizeObserver measure
  // their edits after layout instead of forcing layout during every React commit.
  // Mounts, collapse transitions, and capped rows still need a synchronous check.
  const synchronousMeasurementKey =
    expanded && typeof ResizeObserver !== 'undefined' ? undefined : measurementKey;
  useLayoutEffect(checkOverflow, [checkOverflow, synchronousMeasurementKey]);

  // ResizeObserver for async layout shifts (lazy images, font loading, etc.).
  // Re-observe edits even when height stays unchanged: the initial entry warms
  // the new key's verdict for virtualized remounts without forcing layout here.
  useEffect(() => {
    const el = contentRef.current;
    if (isExempt || forceOverflowing || !el || typeof ResizeObserver === 'undefined')
      return undefined;
    const observer = new ResizeObserver(() => {
      const result = isContentOverflowing(el, expanded);
      if (result !== null) {
        applyOverflowVerdict(result);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt, measurementKey]);

  // IntersectionObserver: re-check overflow when element enters the viewport.
  // Catches elements that had zero scrollHeight when first measured off-screen.
  useEffect(() => {
    const el = contentRef.current;
    if (
      isExempt ||
      forceOverflowing ||
      !el ||
      expanded ||
      typeof IntersectionObserver === 'undefined'
    )
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const result = isContentOverflowing(el, expanded);
          if (result !== null) {
            applyOverflowVerdict(result);
          }
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyOverflowVerdict, expanded, forceOverflowing, isExempt]);

  const setManualExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (manualExpansionState && expansionKey !== undefined) {
        rememberManualExpansionState(manualExpansionState, expansionKey, nextExpanded);
      }
      setExpanded(nextExpanded);
    },
    [expansionKey, manualExpansionState]
  );

  const handleExpandClick = useCallback(() => {
    setManualExpanded(true);
  }, [setManualExpanded]);

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setManualExpanded(false);
    },
    [setManualExpanded]
  );

  const showToggle = !isExempt && overflowing;
  const isCollapsed = showToggle && !expanded;
  const toggleLabel = expanded ? 'Show less' : 'Show full message';
  const shouldLoadFullContent = effectiveExpanded || loadFullContent;
  const renderedChildren =
    typeof children === 'function'
      ? children({ expanded: effectiveExpanded, loadFullContent: shouldLoadFullContent })
      : children;

  return (
    <div className={css.CollapsibleContainer}>
      <div
        id={contentId}
        ref={contentRef}
        className={css.CollapsibleContent({ collapsed: isCollapsed })}
        aria-expanded={isExempt ? undefined : expanded}
        style={{
          maxHeight: effectiveExpanded ? undefined : MAX_HEIGHT,
          overflow: effectiveExpanded ? undefined : 'hidden',
        }}
      >
        {renderedChildren}
      </div>
      {showToggle && (
        <div
          data-message-disclosure=""
          className={expanded ? css.CollapsibleStickyFooter : css.CollapsibleFooter}
        >
          <button
            type="button"
            className={css.CollapsiblePill}
            aria-label={toggleLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={expanded ? handleCollapseClick : handleExpandClick}
          >
            <span>{toggleLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
