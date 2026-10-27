import { useTranslation } from 'react-i18next';
import React, {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import classNames from 'classnames';
import { color, config, toRem } from 'folds';
import type { IContent } from 'matrix-js-sdk';
import { glassFloating, glassSurface } from '../../../styles/Glass.css';
import { CollapsibleMessageStateProvider } from '../CollapsibleMessage';
import { useTimelineBulkExpansionAnchor } from '../useTimelineBulkExpansionAnchor';
import { consumeLiveExpandOnceId, getCollapsibleMessageMode } from '../threadCollapsibleMessages';

export const useTimelineMessageExpansion = (
  roomId: string,
  threadId: string | undefined,
  scrollRef: RefObject<HTMLDivElement>
) => {
  const { t } = useTranslation();
  // The owning timeline is keyed by room:thread; manual choices reset on remount.
  const [expandAll, setExpandAll] = useState(false);
  const manualExpansionState = useRef(new Map<string, boolean>());
  const liveExpandOnceIds = useRef(new Set<string>());
  const restoreBulkExpansionAnchor = useTimelineBulkExpansionAnchor(expandAll, scrollRef);
  useEffect(() => {
    liveExpandOnceIds.current.clear();
  }, [roomId, threadId]);

  const markLiveExpansionCandidate = useCallback((eventId: string) => {
    liveExpandOnceIds.current.add(eventId);
  }, []);
  const getExpansion = (eventId: string, content: IContent, isAgentMessage: boolean) => {
    const collapseMode = getCollapsibleMessageMode(
      eventId,
      content,
      liveExpandOnceIds.current,
      isAgentMessage
    );
    return {
      collapseMode,
      onInitialExpandConsumed:
        collapseMode === 'initially-expanded'
          ? () => {
              consumeLiveExpandOnceId(liveExpandOnceIds.current, eventId);
            }
          : undefined,
    } as const;
  };
  const wrapExpansion = (children: ReactNode) => (
    <CollapsibleMessageStateProvider
      expandAllInit={expandAll}
      manualExpansionState={manualExpansionState.current}
      onExpansionLayoutChange={restoreBulkExpansionAnchor}
    >
      {children}
    </CollapsibleMessageStateProvider>
  );
  const expansionControl = (
    <button
      type="button"
      // Rows scroll under this control, so it carries its own glass to stay readable.
      className={classNames(
        glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
        glassFloating
      )}
      onClick={(e) => {
        e.preventDefault();
        manualExpansionState.current.clear();
        // Rows follow the new baseline one commit later, so the anchor is captured before they resize.
        setExpandAll(!expandAll);
      }}
      style={{
        position: 'absolute',
        // Ends where the bare label did, inside the clear band above the first row.
        top: config.space.S100,
        right: config.space.S400,
        zIndex: 2,
        color: color.Primary.Main,
        cursor: 'pointer',
        fontSize: '0.75rem',
        fontFamily: 'var(--font-mono)',
        border: 'none',
        borderRadius: config.radii.R300,
        padding: `${toRem(2)} ${config.space.S200}`,
      }}
    >
      {expandAll
        ? t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all')
        : t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all2')}
    </button>
  );
  return { markLiveExpansionCandidate, getExpansion, wrapExpansion, expansionControl };
};
