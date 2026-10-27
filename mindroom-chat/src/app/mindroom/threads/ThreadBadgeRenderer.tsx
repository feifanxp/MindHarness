import React, { type MouseEventHandler } from 'react';
import { Room } from 'matrix-js-sdk';
import { Box, config } from 'folds';
import { ThreadIndicator } from './ThreadIndicator';
import { MindroomThreadSummaryCard } from '../messages/MindroomThreadSummaryCard';
import type { ThreadBadgeViewModel } from './types';

type ThreadBadgeRendererProps = {
  model: ThreadBadgeViewModel | undefined;
  room: Room;
  onClick: MouseEventHandler;
  includeRecentSummaryData?: boolean;
};

export const ThreadBadgeRenderer = ({
  model,
  room,
  onClick,
  includeRecentSummaryData = false,
}: ThreadBadgeRendererProps): React.ReactNode => {
  if (!model) return null;

  const { threadRootId } = model.id;

  return (
    <>
      {model.summaryInfo && (
        <Box style={{ marginTop: config.space.S200 }}>
          <MindroomThreadSummaryCard
            compact
            summaryInfo={model.summaryInfo}
            renderBody={({ body }) => <>{body}</>}
          />
        </Box>
      )}
      <ThreadIndicator
        as="button"
        style={{ marginTop: model.summaryInfo ? config.space.S100 : config.space.S200 }}
        data-thread-root-id={threadRootId}
        data-event-id={threadRootId}
        data-thread-summary={includeRecentSummaryData ? model.recentThreadSummaryText : undefined}
        threadReplyCount={model.replyCount}
        threadParticipantIds={model.participantIds}
        isResolved={model.isResolved}
        threadRootId={threadRootId}
        room={room}
        onClick={onClick}
      />
    </>
  );
};
