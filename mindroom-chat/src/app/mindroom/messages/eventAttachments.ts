import type { MatrixEvent } from 'matrix-js-sdk';
import { describeMatrixEventRevision } from '../threads/eventRevision';
import type { IEncryptedFile } from '../../../types/matrix/common';
import { getMindroomLongTextSource } from './longText';

export const ESSENTIAL_BODY_MAX_BYTES = 32 * 1024 * 1024;
export const AUTO_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export type EventAttachment = {
  mxcUri: string;
  encryptedFile?: IEncryptedFile;
  mimeType?: string;
  essential: boolean;
  isV2ContentJson?: boolean;
  maxBytes?: number;
  autoDownload: boolean;
};
export type EventAttachmentOwner = {
  roomId: string;
  eventId: string;
  revisionTs: number;
  revisionId?: string;
  redacted?: boolean;
};
export type EventAttachmentMessage = EventAttachmentOwner & { attachments: EventAttachment[] };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export const getEventAttachmentOwner = (
  event?: MatrixEvent,
  target?: MatrixEvent
): EventAttachmentOwner | undefined => {
  if (!event?.getRoomId?.() || event.status || event.replacingEvent()?.status) return undefined;
  const roomId = event.getRoomId();
  const relation = event.getRelation();
  if (
    relation?.rel_type === 'm.replace' &&
    (!target ||
      target.getId() !== relation.event_id ||
      target.getRoomId() !== roomId ||
      !event.getSender() ||
      event.getSender() !== target.getSender() ||
      target.isRedacted())
  )
    return undefined;
  const redaction = event.getType() === 'm.room.redaction';
  const eventId = redaction
    ? event.event.redacts ?? event.getContent().redacts
    : relation?.rel_type === 'm.replace'
    ? relation.event_id
    : event.getId();
  if (!roomId || !eventId) return undefined;
  const revision = describeMatrixEventRevision(event);
  const redactedAt = event.getUnsigned().redacted_because?.origin_server_ts;
  const revisionTs =
    event.isRedacted() && typeof redactedAt === 'number'
      ? redactedAt
      : revision.replacement?.ts ?? event.getTs();

  return {
    roomId,
    eventId,
    revisionTs,
    revisionId:
      revision.replacement?.eventId ?? (relation?.rel_type === 'm.replace' ? event.getId() : ''),
    redacted: redaction || event.isRedacted(),
  };
};

/** Pure description of current message revisions; no cache, I/O or decrypted-key persistence. */
export const collectEventAttachments = (
  events: readonly MatrixEvent[]
): EventAttachmentMessage[] => {
  const messages = new Map<string, EventAttachmentMessage>();
  events.forEach((event) => {
    const replacement = event.replacingEvent();
    // Unknown event or replacement content cannot retire the last readable attachment revision.
    if (
      !event.isRedacted() &&
      (event.isDecryptionFailure() ||
        replacement?.getType() === 'm.room.encrypted' ||
        replacement?.isDecryptionFailure())
    )
      return;
    const targetId = event.getRelation()?.event_id;
    const owner = getEventAttachmentOwner(
      event,
      events.find(
        (candidate) => candidate.getId() === targetId && candidate.getRoomId() === event.getRoomId()
      )
    );
    if (!owner || !['m.room.message', 'm.room.redaction', 'm.sticker'].includes(event.getType()))
      return;
    const { roomId, eventId, revisionTs } = owner;
    const relation = event.getRelation();
    const redaction = event.getType() === 'm.room.redaction';
    const key = JSON.stringify([roomId, eventId]);
    const previous = messages.get(key);
    if (
      previous?.redacted ||
      (previous &&
        !owner.redacted &&
        (previous.revisionTs > revisionTs ||
          (previous.revisionTs === revisionTs &&
            (previous.revisionId ?? '') > (owner.revisionId ?? ''))))
    )
      return;
    const content =
      redaction || event.isRedacted()
        ? {}
        : relation?.rel_type === 'm.replace'
        ? record(event.getContent()['m.new_content'])
        : event.getContent();
    const attachments: EventAttachment[] = [];
    const longText = getMindroomLongTextSource(content);
    if (longText)
      attachments.push({
        mxcUri: longText.mxcUri,
        encryptedFile: longText.encryptedFile,
        isV2ContentJson: longText.isV2ContentJson,
        essential: true,
        autoDownload: true,
        maxBytes: ESSENTIAL_BODY_MAX_BYTES,
      });
    const add = (url: unknown, file: unknown, info: Record<string, unknown>) => {
      const encryptedFile = record(file);
      const mxcUri = typeof encryptedFile.url === 'string' ? encryptedFile.url : url;
      if (
        typeof mxcUri !== 'string' ||
        !mxcUri.startsWith('mxc://') ||
        attachments.some((item) => item.mxcUri === mxcUri)
      )
        return;
      const size = info.size;
      attachments.push({
        mxcUri,
        encryptedFile: typeof encryptedFile.url === 'string' ? (file as IEncryptedFile) : undefined,
        mimeType: typeof info.mimetype === 'string' ? info.mimetype : undefined,
        essential: false,
        autoDownload:
          typeof size === 'number' &&
          Number.isFinite(size) &&
          size >= 0 &&
          size <= AUTO_MEDIA_MAX_BYTES,
      });
    };
    if (
      event.getType() === 'm.sticker' ||
      (typeof content.msgtype === 'string' &&
        ['m.image', 'm.audio', 'm.video', 'm.file'].includes(content.msgtype))
    )
      add(content.url, content.file, record(content.info));
    const info = record(content.info);
    add(info.thumbnail_url, info.thumbnail_file, record(info.thumbnail_info));
    messages.set(key, { ...owner, attachments });
  });
  return [...messages.values()];
};
