import { useTranslation } from 'react-i18next';
import React, { ReactNode, useContext } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { MessageEditedContent } from '../../components/message/content';
import { MessageTextBody } from '../../components/message/layout';
import type { MindroomThreadSummaryInfo } from './threadSummary';
import * as css from './MindroomThreadSummaryCard.css';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';
import { HideRoomThreadsContext } from '../../hooks/roomThreadVisibility';

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type MindroomThreadSummaryCardProps = {
  edited?: boolean;
  compact?: boolean;
  summaryInfo: MindroomThreadSummaryInfo;
  renderBody: (props: RenderBodyProps) => ReactNode;
};

export function MindroomThreadSummaryCard({
  edited,
  compact,
  summaryInfo,
  renderBody,
}: MindroomThreadSummaryCardProps) {
  const hideRoomThreads = useContext(HideRoomThreadsContext);
  const glassRef = useGlassHighlight<HTMLDivElement>();
  const { t } = useTranslation();
  const summaryText = summaryInfo.summaryText ?? t('sharedUi.threadSummary.title');
  const provenanceLabel = summaryInfo.isManual
    ? t('sharedUi.threadSummary.manual')
    : typeof summaryInfo.messageCount === 'number'
    ? t('sharedUi.threadSummary.provenanceCount', { count: summaryInfo.messageCount })
    : t('sharedUi.threadSummary.provenance');

  if (hideRoomThreads) return null;

  return (
    <Box
      ref={glassRef}
      className={css.ThreadSummaryCard}
      direction="Column"
      gap="100"
      aria-label={t(
        summaryInfo.isManual
          ? 'sharedUi.threadSummary.title'
          : 'mindroomUi.messages.mindroomThreadSummaryCard.aiThreadSummary'
      )}
    >
      <Box className={css.ThreadSummaryHeader}>
        <Box as="span" className={css.ThreadSummaryLabel}>
          <Icon size="50" src={Icons.Bulb} />
          <Text as="span" size="T200">
            {provenanceLabel}
          </Text>
        </Box>
      </Box>

      <MessageTextBody
        preWrap
        className={compact ? css.ThreadSummaryBodyCompact : css.ThreadSummaryBody}
      >
        {renderBody({ body: summaryText })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
    </Box>
  );
}
