import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { GetContentCallback } from '../../../types/matrix/room';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { RedactedContent } from '../../components/message';
import { getToolApprovalRenderContent, MINDROOM_TOOL_APPROVAL_EVENT } from './toolApproval';

export const MINDROOM_PINNED_TOOL_APPROVAL_EVENT = MINDROOM_TOOL_APPROVAL_EVENT;

type PinnedToolApprovalRenderOptions = {
  displayName: string;
  roomId: string;
  eventId?: string;
  editedEvent?: MatrixEvent;
  mediaAutoLoad: boolean;
  urlPreview: boolean;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: LinkifyOpts;
  outlineAttachment?: boolean;
};

export const isMindroomPinnedToolApprovalEvent = (eventType: string): boolean =>
  eventType === MINDROOM_PINNED_TOOL_APPROVAL_EVENT;

export const renderMindroomPinnedToolApprovalEvent = (
  event: MatrixEvent,
  {
    displayName,
    roomId,
    eventId,
    editedEvent,
    mediaAutoLoad,
    urlPreview,
    htmlReactParserOptions,
    linkifyOpts,
    outlineAttachment,
  }: PinnedToolApprovalRenderOptions
) => {
  if (event.isRedacted()) {
    return <RedactedContent reason={event.getUnsigned().redacted_because?.content.reason} />;
  }

  const resolvedEditedEvent = editedEvent ?? event.replacingEvent();
  const approvalContent = getToolApprovalRenderContent(
    event.getOriginalContent() as Record<string, unknown>,
    resolvedEditedEvent?.getContent() as Record<string, unknown> | undefined
  );
  const getApprovalContent = (() => approvalContent) as GetContentCallback;

  return (
    <RenderMessageContent
      mEvent={event}
      displayName={displayName}
      eventType={event.getType()}
      roomId={roomId}
      eventId={eventId ?? event.getId() ?? undefined}
      threadId={event.threadRootId}
      msgType={typeof approvalContent.msgtype === 'string' ? approvalContent.msgtype : ''}
      ts={event.getTs()}
      edited={!!resolvedEditedEvent}
      getContent={getApprovalContent}
      mediaAutoLoad={mediaAutoLoad}
      urlPreview={urlPreview}
      htmlReactParserOptions={htmlReactParserOptions}
      linkifyOpts={linkifyOpts}
      outlineAttachment={outlineAttachment}
    />
  );
};
