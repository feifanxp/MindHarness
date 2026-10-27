import React, { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { PopOut, Text, Tooltip, type RectCords } from 'folds';
import { IconSparkles } from '@tabler/icons-react';
import type { MindroomThreadSummaryInfo } from './threadSummary';
import type { ThreadSummaryMarkerPlan } from '../threads/threadSummaryTimeline';
import * as css from './MindroomThreadSummaryMarker.css';

type MindroomThreadSummaryMarkerProps = {
  summaryInfo: MindroomThreadSummaryInfo;
  plan?: ThreadSummaryMarkerPlan;
};

type OpenMode = 'hover' | 'pinned';

// Inside a thread the banner already shows the current summary, so a summary
// event shrinks to one quiet line under the reply before it. Hovering it, or
// tapping it on a phone, shows the full title and the one it replaced.
export function MindroomThreadSummaryMarker({
  summaryInfo,
  plan,
}: MindroomThreadSummaryMarkerProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ mode: OpenMode; anchor: RectCords }>();
  const descriptionId = useId();

  const show = (mode: OpenMode) => {
    const trigger = triggerRef.current;
    if (trigger) setOpen({ mode, anchor: trigger.getBoundingClientRect() });
  };

  const isOpen = !!open;
  useEffect(() => {
    if (!isOpen) return undefined;
    const close = () => setOpen(undefined);
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') close();
    };
    const onPointerDown = (evt: Event) => {
      if (!triggerRef.current?.contains(evt.target as Node)) close();
    };
    // The details sit at a fixed spot; the timeline scrolls on its own as rows
    // arrive and settle, so they follow the marker instead of closing.
    const onScroll = () => {
      const trigger = triggerRef.current;
      if (trigger)
        setOpen((current) => current && { ...current, anchor: trigger.getBoundingClientRect() });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen]);

  let label = t('mindroomUi.messages.mindroomThreadSummaryMarker.updated');
  if (summaryInfo.isManual) label = t('mindroomUi.messages.mindroomThreadSummaryMarker.edited');
  else if (plan?.first) label = t('mindroomUi.messages.mindroomThreadSummaryMarker.titled');

  let provenance = t('sharedUi.threadSummary.provenance');
  if (summaryInfo.isManual) provenance = t('sharedUi.threadSummary.manual');
  else if (typeof summaryInfo.messageCount === 'number')
    provenance = t('sharedUi.threadSummary.provenanceCount', { count: summaryInfo.messageCount });

  const previous = plan?.previousSummaryText && (
    <Trans
      t={t}
      shouldUnescape
      tOptions={{ interpolation: { escapeValue: true } }}
      i18nKey="mindroomUi.messages.mindroomThreadSummaryMarker.previous"
      values={{ summary: plan.previousSummaryText }}
      components={{ old: <s /> }}
    />
  );

  return (
    <div className={css.Marker}>
      <button
        ref={triggerRef}
        type="button"
        className={css.MarkerTrigger}
        aria-expanded={isOpen}
        aria-describedby={descriptionId}
        onPointerEnter={(evt: PointerEvent) => {
          if (evt.pointerType === 'mouse' && !open) show('hover');
        }}
        onPointerLeave={(evt: PointerEvent) => {
          if (evt.pointerType === 'mouse' && open?.mode === 'hover') setOpen(undefined);
        }}
        onClick={() => (open?.mode === 'pinned' ? setOpen(undefined) : show('pinned'))}
        onBlur={() => setOpen(undefined)}
      >
        <IconSparkles size={14} aria-hidden />
        <Text as="span" size="T200">
          {label}
        </Text>
      </button>
      <span id={descriptionId} hidden>
        {summaryInfo.summaryText} {previous}
      </span>
      {/* folds' PopOut layer covers the screen; as a tooltip it must let the
          pointer through to the marker and the timeline. */}
      <PopOut
        role="tooltip"
        style={{ pointerEvents: 'none' }}
        anchor={open?.anchor}
        position="Top"
        align="Start"
        offset={4}
        content={
          <Tooltip>
            <div className={css.MarkerDetails} data-thread-summary-details="true">
              <Text size="T200" priority="300">
                {provenance}
              </Text>
              <Text size="T300">{summaryInfo.summaryText}</Text>
              {previous && (
                <Text size="T200" priority="300">
                  {previous}
                </Text>
              )}
            </div>
          </Tooltip>
        }
      />
    </div>
  );
}
