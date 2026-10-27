import { IEventWithRoomId, MsgType, RelationType } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { MessageEvent } from '../../../types/matrix/room';
import { shouldUseMindroomLightweightSearchResultBody } from '../messages/searchResultPolicy';
import { parseBlockMD, parseInlineMD } from '../../plugins/markdown';

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
export const SEARCH_RESULT_BODY_CHAR_LIMIT = 1600;
export const SEARCH_RESULT_RICH_BODY_CHAR_LIMIT = 600;
export const SEARCH_RESULT_LIGHTWEIGHT_FORMATTED_BODY_CHAR_LIMIT = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withBody = (label: string, body?: string): string => {
  const normalizedBody = typeof body === 'string' ? collapseWhitespace(body) : '';
  return normalizedBody ? `${label}: ${normalizedBody}` : label;
};

const findFirstHighlightIndex = (body: string, highlights: string[]): number => {
  const loweredBody = body.toLocaleLowerCase();
  let firstMatchIndex = -1;

  for (const highlight of highlights) {
    if (!highlight) continue;
    const index = loweredBody.indexOf(highlight.toLocaleLowerCase());
    if (index >= 0 && (firstMatchIndex === -1 || index < firstMatchIndex)) {
      firstMatchIndex = index;
    }
  }

  return firstMatchIndex;
};

export const getSearchResultBodySnippet = (
  body: string,
  highlights: string[] = [],
  maxChars = SEARCH_RESULT_BODY_CHAR_LIMIT
): string => {
  if (body.length <= maxChars) return body;

  const targetIndex = findFirstHighlightIndex(body, highlights);
  const windowSize = Math.max(maxChars - 2, 0);
  const start =
    targetIndex >= 0
      ? Math.max(0, Math.min(targetIndex - Math.floor(windowSize * 0.3), body.length - windowSize))
      : 0;
  const end = Math.min(body.length, start + windowSize);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';

  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
};

const getSerializedReplacementContent = (
  event: IEventWithRoomId
): IEventWithRoomId['content'] | undefined => {
  const unsignedRelations = event.unsigned?.['m.relations'];
  if (!isRecord(unsignedRelations)) return undefined;

  const replacement = unsignedRelations[RelationType.Replace];
  if (!isRecord(replacement) || !isRecord(replacement.content)) return undefined;

  const replacementNewContent = replacement.content['m.new_content'];
  if (isRecord(replacementNewContent)) {
    return replacementNewContent as IEventWithRoomId['content'];
  }

  return replacement.content as IEventWithRoomId['content'];
};

export const getSearchResultEffectiveContent = (
  event: IEventWithRoomId
): IEventWithRoomId['content'] => {
  const relation = event.content?.['m.relates_to'];
  const inlineNewContent = event.content?.['m.new_content'];
  if (relation?.rel_type === RelationType.Replace && isRecord(inlineNewContent)) {
    return inlineNewContent as IEventWithRoomId['content'];
  }

  const serializedReplacementContent = getSerializedReplacementContent(event);
  if (serializedReplacementContent) {
    return serializedReplacementContent;
  }

  if (isRecord(inlineNewContent)) {
    return inlineNewContent as IEventWithRoomId['content'];
  }

  return event.content;
};

export const isSearchResultEdited = (event: IEventWithRoomId): boolean =>
  event.content?.['m.relates_to']?.rel_type === RelationType.Replace ||
  isRecord(event.content?.['m.new_content']) ||
  !!getSerializedReplacementContent(event);

export const shouldUseLightweightSearchResultBody = (
  content: IEventWithRoomId['content']
): boolean => {
  const body = typeof content?.body === 'string' ? content.body : undefined;
  const formattedBody =
    typeof content?.formatted_body === 'string' ? content.formatted_body : undefined;

  return (
    shouldUseMindroomLightweightSearchResultBody(content as Record<string, unknown>) ||
    (typeof body === 'string' && body.length > SEARCH_RESULT_RICH_BODY_CHAR_LIMIT) ||
    (typeof formattedBody === 'string' &&
      formattedBody.length > SEARCH_RESULT_RICH_BODY_CHAR_LIMIT * 2)
  );
};

export const getSearchResultLightweightFormattedBody = (
  content: IEventWithRoomId['content']
): string | undefined => {
  const formattedBody =
    typeof content?.formatted_body === 'string' ? content.formatted_body : undefined;

  if (
    typeof formattedBody === 'string' &&
    formattedBody.length <= SEARCH_RESULT_LIGHTWEIGHT_FORMATTED_BODY_CHAR_LIMIT
  ) {
    return formattedBody;
  }

  return undefined;
};

export const getSearchResultLightweightCustomBody = (
  content: IEventWithRoomId['content'],
  previewText: string
): string | undefined => {
  const formattedBody = getSearchResultLightweightFormattedBody(content);
  if (formattedBody) return formattedBody;

  const markdownHtml = parseBlockMD(previewText, parseInlineMD);
  if (markdownHtml !== previewText) {
    return markdownHtml;
  }

  return undefined;
};

export const getSearchResultPreviewText = (
  event: IEventWithRoomId,
  highlights: string[] = [],
  t?: TFunction
): string => {
  if (event.unsigned?.redacted_because) {
    return t?.('mindroomUi.message-search.searchResultPreview.redacted') ?? 'Message was redacted.';
  }

  const content = getSearchResultEffectiveContent(event);
  const body = typeof content?.body === 'string' ? content.body : undefined;
  const previewBody =
    typeof body === 'string'
      ? getSearchResultBodySnippet(collapseWhitespace(body), highlights)
      : undefined;

  if (event.type === MessageEvent.RoomMessage) {
    switch (content?.msgtype) {
      case MsgType.Text:
      case MsgType.Notice:
      case MsgType.Emote:
        return (
          previewBody ?? t?.('mindroomUi.message-search.searchResultPreview.message') ?? 'Message'
        );
      case MsgType.Image:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.image') ?? 'Image',
          previewBody
        );
      case MsgType.Video:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.video') ?? 'Video',
          previewBody
        );
      case MsgType.Audio:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.audio') ?? 'Audio',
          previewBody
        );
      case MsgType.File:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.file') ?? 'File',
          previewBody
        );
      case MsgType.Location:
        return withBody(
          t?.('mindroomUi.message-search.searchResultPreview.location') ?? 'Location',
          previewBody
        );
      default:
        return collapseWhitespace(
          previewBody ??
            content?.msgtype ??
            t?.('mindroomUi.message-search.searchResultPreview.message') ??
            'Message'
        );
    }
  }

  if (event.type === MessageEvent.Reaction) {
    return t?.('mindroomUi.message-search.searchResultPreview.reaction') ?? 'Reaction';
  }

  return collapseWhitespace(
    body ??
      event.type ??
      t?.('mindroomUi.message-search.searchResultPreview.unsupportedEvent') ??
      'Unsupported event'
  );
};
