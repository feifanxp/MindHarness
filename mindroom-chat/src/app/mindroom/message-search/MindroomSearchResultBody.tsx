import { useTranslation } from 'react-i18next';
import React, { useMemo } from 'react';
import { IEventWithRoomId, MsgType } from 'matrix-js-sdk';
import { Text } from 'folds';
import { MEmote, MNotice, MText, RedactedContent, RenderBody } from '../../components/message';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeHighlightRegex,
} from '../../plugins/react-custom-html-parser';
import { MessageEvent } from '../../../types/matrix/room';
import {
  getSearchResultEffectiveContent,
  getSearchResultLightweightCustomBody,
  getSearchResultPreviewText,
  isSearchResultEdited,
  shouldUseLightweightSearchResultBody,
} from './searchResultPreview';

type MindroomSearchResultBodyProps = {
  roomId: string;
  event: IEventWithRoomId;
  displayName: string;
  highlights: string[];
};

export function MindroomSearchResultBody({
  roomId,
  event,
  displayName,
  highlights,
}: MindroomSearchResultBodyProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const redactedBecause = event.unsigned?.redacted_because;

  const edited = isSearchResultEdited(event);
  const effectiveContent = getSearchResultEffectiveContent(event);
  const useLightweightBody = shouldUseLightweightSearchResultBody(effectiveContent);
  const highlightRegex = useMemo(() => makeHighlightRegex(highlights), [highlights]);
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(mx, roomId, {
        linkifyOpts: LINKIFY_OPTS,
        highlightRegex,
        useAuthentication,
      }),
    [highlightRegex, mx, roomId, useAuthentication]
  );
  const needsPreviewText = useLightweightBody || !highlightRegex;
  const previewText = useMemo(
    () => (needsPreviewText ? getSearchResultPreviewText(event, highlights, t) : undefined),
    [event, highlights, needsPreviewText, t]
  );
  const content = useMemo(() => {
    if (!useLightweightBody) return effectiveContent;

    const nextPreviewText = previewText ?? getSearchResultPreviewText(event, highlights, t);
    return {
      ...effectiveContent,
      body: nextPreviewText,
      formatted_body: getSearchResultLightweightCustomBody(effectiveContent, nextPreviewText),
    };
  }, [effectiveContent, event, highlights, previewText, t, useLightweightBody]);

  if (redactedBecause) {
    return <RedactedContent reason={redactedBecause.content.reason} />;
  }

  const renderSnippetBody = () => {
    if (!previewText) return null;

    return (
      <RenderBody
        body={previewText}
        highlightRegex={highlightRegex}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );
  };

  if (useLightweightBody) {
    if (event.type === MessageEvent.RoomMessage) {
      const renderBody = (props: { body: string; customBody?: string }) => (
        <RenderBody
          {...props}
          highlightRegex={highlightRegex}
          htmlReactParserOptions={htmlReactParserOptions}
          linkifyOpts={LINKIFY_OPTS}
        />
      );

      switch (content.msgtype) {
        case MsgType.Text:
          return <MText edited={edited} content={content} renderBody={renderBody} />;
        case MsgType.Notice:
          return <MNotice edited={edited} content={content} renderBody={renderBody} />;
        case MsgType.Emote:
          return (
            <MEmote
              displayName={displayName}
              edited={edited}
              content={content}
              renderBody={renderBody}
            />
          );
        default:
          break;
      }
    }

    return (
      <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {renderSnippetBody()}
        {edited && t('mindroomUi.message-search.mindroomSearchResultBody.edited')}
      </Text>
    );
  }

  if (!highlightRegex) {
    return (
      <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {renderSnippetBody()}
        {edited && t('mindroomUi.message-search.mindroomSearchResultBody.edited')}
      </Text>
    );
  }

  if (event.type === MessageEvent.RoomMessage) {
    const renderBody = (props: { body: string; customBody?: string }) => (
      <RenderBody
        {...props}
        highlightRegex={highlightRegex}
        htmlReactParserOptions={htmlReactParserOptions}
        linkifyOpts={LINKIFY_OPTS}
      />
    );

    switch (content.msgtype) {
      case MsgType.Text:
        return <MText edited={edited} content={content} renderBody={renderBody} />;
      case MsgType.Notice:
        return <MNotice edited={edited} content={content} renderBody={renderBody} />;
      case MsgType.Emote:
        return (
          <MEmote
            displayName={displayName}
            edited={edited}
            content={content}
            renderBody={renderBody}
          />
        );
      default:
        break;
    }
  }

  return (
    <Text size="T400" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {renderSnippetBody()}
    </Text>
  );
}
