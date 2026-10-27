import type { IContent, IEventRelation, MatrixClient, Room } from 'matrix-js-sdk';
import {
  buildMindroomLongTextPreview,
  contentBytes,
  getMindroomLongTextSource,
  MAX_EVENT_CONTENT_BYTES,
  MindroomLongTextSource,
} from './longText';
import { uploadMindroomLongTextSidecar } from './longTextSidecarUpload';

/**
 * The edit event for new content. One that does not fit one event is uploaded whole as a long-text
 * sidecar, as MindRoom's backend uploads its own large edits: MindRoom reads the file in place of
 * the event and takes the message from its `m.new_content`, and Chat does the same. The event then
 * replaces the message with the sidecar's preview.
 */
export const buildMindroomEditContent = async (
  mx: MatrixClient,
  room: Room,
  newContent: IContent,
  relation: IEventRelation
): Promise<IContent> => {
  const edit: IContent = {
    ...newContent,
    body: `* ${newContent.body}`,
    'm.new_content': newContent,
    'm.relates_to': relation,
  };
  if (contentBytes(edit) <= MAX_EVENT_CONTENT_BYTES) return edit;

  const replacement = await uploadMindroomLongTextSidecar(
    mx,
    room,
    edit,
    buildMindroomLongTextPreview(newContent)
  );
  return {
    msgtype: newContent.msgtype,
    body: `* ${replacement.body}`,
    ...(newContent['m.mentions'] === undefined ? {} : { 'm.mentions': newContent['m.mentions'] }),
    'm.new_content': replacement,
    'm.relates_to': relation,
  };
};

/**
 * The content to edit: a message sent as a long-text sidecar is edited from its whole content, so
 * `undefined` when that cannot be loaded, because saving its preview would cut the message.
 */
export const loadMindroomEditableContent = async (
  content: Record<string, unknown>,
  hydrate: (source: MindroomLongTextSource) => Promise<Record<string, unknown>>
): Promise<Record<string, unknown> | undefined> => {
  const source = getMindroomLongTextSource(content);
  if (!source) return content;
  const whole = await hydrate(source);
  return whole === source.previewContent ? undefined : whole;
};
