import { MsgType } from 'matrix-js-sdk';

export const MINDROOM_PASTE_EVENT_CONTENT_BUDGET_BYTES = 56 * 1024;

type EstimateMindroomTextMessageContentOptions = {
  body: string;
  formattedBody?: string;
  msgType?: MsgType.Text | MsgType.Notice | MsgType.Emote;
};

type ShouldConvertPasteToAttachmentOptions = {
  currentPlainText: string;
  currentFormattedBody?: string;
  pastedText: string;
  includeFormattedPaste?: boolean;
  budgetBytes?: number;
  msgType?: MsgType.Text | MsgType.Notice | MsgType.Emote;
};

const textEncoder = new TextEncoder();

const escapeHtmlText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const byteLength = (text: string): number => textEncoder.encode(text).byteLength;

export const estimateMindroomTextMessageContentBytes = ({
  body,
  formattedBody,
  msgType = MsgType.Text,
}: EstimateMindroomTextMessageContentOptions): number => {
  const content: Record<string, unknown> = {
    msgtype: msgType,
    body,
  };

  if (formattedBody !== undefined) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = formattedBody;
  }

  return byteLength(JSON.stringify(content));
};

export const shouldConvertPasteToAttachment = ({
  currentPlainText,
  currentFormattedBody,
  pastedText,
  includeFormattedPaste = false,
  budgetBytes = MINDROOM_PASTE_EVENT_CONTENT_BUDGET_BYTES,
  msgType = MsgType.Text,
}: ShouldConvertPasteToAttachmentOptions): boolean => {
  const body = `${currentPlainText}${pastedText}`;
  const formattedBody =
    currentFormattedBody !== undefined || includeFormattedPaste
      ? `${currentFormattedBody ?? ''}${escapeHtmlText(pastedText)}`
      : undefined;

  return (
    estimateMindroomTextMessageContentBytes({
      body,
      formattedBody,
      msgType,
    }) > budgetBytes
  );
};
