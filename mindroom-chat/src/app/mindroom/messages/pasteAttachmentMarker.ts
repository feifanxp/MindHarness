import type { IEncryptedFile } from '../../../types/matrix/common';

export type MindroomPasteMarker = {
  id: string;
  chars: number;
  fileName: string;
  raw: string;
};

export type MindroomPasteAttachmentMetadata = {
  version: 1;
  id: string;
  chars: number;
  file: string;
};

export type MindroomPasteAttachment = {
  id: string;
  marker: string;
  file: File;
};

export type MindroomPasteAttachmentFile = {
  id: string;
  chars?: number;
  fileName: string;
  mxcUri: string;
  mimeType: string;
  size?: number;
  encryptedFile?: IEncryptedFile;
};

export type MindroomPasteMarkerMatch = {
  marker: MindroomPasteMarker;
  index: number;
  length: number;
};

type CreateMindroomPasteAttachmentOptions = {
  id?: string;
};

const PASTE_ID_BYTE_LENGTH = 3;
const PASTE_ID_REG = /^paste-[a-f0-9]{6}$/;
const PASTE_FILE_NAME_REG = /^mindroom-(paste-[a-f0-9]{6})\.txt$/;
const MINDROOM_PASTE_TEXT_MIME_TYPE = 'text/plain;charset=utf-8';
const MINDROOM_PASTE_MARKER_VERSION = 1;

export const MINDROOM_PASTE_MARKER_START = '[[mindroom-paste:';
export const MINDROOM_PASTE_MARKER_END = ']]';
export const MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY = 'io.mindroom.paste_attachment';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const escapeHtmlText = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const bytesToLowercaseHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const getRandomBytes = (): Uint8Array => {
  const bytes = new Uint8Array(PASTE_ID_BYTE_LENGTH);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

export const createMindroomPasteId = (randomBytes: () => Uint8Array = getRandomBytes): string =>
  `paste-${bytesToLowercaseHex(randomBytes()).slice(0, PASTE_ID_BYTE_LENGTH * 2)}`;

export const getMindroomPasteFileName = (id: string): string => {
  if (!PASTE_ID_REG.test(id)) {
    throw new Error(`Invalid MindRoom paste id: ${id}`);
  }
  return `mindroom-${id}.txt`;
};

export const isMindroomPasteFileName = (fileName: string): boolean =>
  PASTE_FILE_NAME_REG.test(fileName);

export const getMindroomPasteIdFromFileName = (fileName: string): string | undefined =>
  fileName.match(PASTE_FILE_NAME_REG)?.[1];

export const createMindroomPasteMarker = ({
  id,
  chars,
  fileName,
}: {
  id: string;
  chars: number;
  fileName: string;
}): string => {
  if (!PASTE_ID_REG.test(id)) {
    throw new Error(`Invalid MindRoom paste id: ${id}`);
  }
  if (!Number.isInteger(chars) || chars < 0) {
    throw new Error(`Invalid MindRoom paste character count: ${chars}`);
  }
  if (!PASTE_FILE_NAME_REG.test(fileName)) {
    throw new Error(`Invalid MindRoom paste file name: ${fileName}`);
  }

  return `${MINDROOM_PASTE_MARKER_START}${JSON.stringify({
    v: MINDROOM_PASTE_MARKER_VERSION,
    id,
    chars,
    file: fileName,
  })}${MINDROOM_PASTE_MARKER_END}`;
};

const markerFromParts = ({
  id,
  chars,
  fileName,
  raw,
}: {
  id: unknown;
  chars: unknown;
  fileName: unknown;
  raw: string;
}): MindroomPasteMarker | undefined => {
  if (typeof id !== 'string' || !PASTE_ID_REG.test(id)) return undefined;
  if (typeof chars !== 'number' || !Number.isInteger(chars) || chars < 0) return undefined;
  if (typeof fileName !== 'string' || !PASTE_FILE_NAME_REG.test(fileName)) return undefined;
  if (fileName !== getMindroomPasteFileName(id)) return undefined;

  return {
    id,
    chars,
    fileName,
    raw,
  };
};

export const createMindroomPasteAttachmentMetadata = ({
  id,
  chars,
  fileName,
}: {
  id: string;
  chars: number;
  fileName: string;
}): MindroomPasteAttachmentMetadata => {
  const marker = markerFromParts({
    id,
    chars,
    fileName,
    raw: '',
  });
  if (!marker) {
    throw new Error('Invalid MindRoom paste attachment metadata.');
  }

  return {
    version: MINDROOM_PASTE_MARKER_VERSION,
    id,
    chars,
    file: fileName,
  };
};

export const parseMindroomPasteAttachmentMetadata = (
  value: unknown
): MindroomPasteAttachmentMetadata | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.version !== MINDROOM_PASTE_MARKER_VERSION) return undefined;

  const marker = markerFromParts({
    id: value.id,
    chars: value.chars,
    fileName: value.file,
    raw: '',
  });
  if (!marker) return undefined;

  return {
    version: MINDROOM_PASTE_MARKER_VERSION,
    id: marker.id,
    chars: marker.chars,
    file: marker.fileName,
  };
};

export const withMindroomPasteAttachmentMetadata = (
  content: Record<string, unknown>,
  metadata: { id: string; chars: number; fileName: string } | undefined
): Record<string, unknown> => {
  if (!metadata) return content;

  return {
    ...content,
    [MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY]: createMindroomPasteAttachmentMetadata(metadata),
  };
};

export const getMindroomPasteAttachmentFile = (
  content: Record<string, unknown>
): MindroomPasteAttachmentFile | undefined => {
  const metadata = parseMindroomPasteAttachmentMetadata(
    content[MINDROOM_PASTE_ATTACHMENT_CONTENT_KEY]
  );
  const contentFileName =
    typeof content.filename === 'string'
      ? content.filename
      : typeof content.body === 'string'
      ? content.body
      : undefined;
  const fileName = metadata?.file ?? contentFileName;
  if (!fileName || !isMindroomPasteFileName(fileName)) return undefined;
  if (metadata && contentFileName && contentFileName !== metadata.file) return undefined;

  const encryptedFile = isRecord(content.file)
    ? (content.file as unknown as IEncryptedFile)
    : undefined;
  const mxcUri =
    typeof encryptedFile?.url === 'string'
      ? encryptedFile.url
      : typeof content.url === 'string'
      ? content.url
      : undefined;
  if (!mxcUri) return undefined;

  const info = isRecord(content.info) ? content.info : undefined;
  const id = metadata?.id ?? getMindroomPasteIdFromFileName(fileName);
  if (!id) return undefined;

  return {
    id,
    chars: metadata?.chars,
    fileName,
    mxcUri,
    mimeType: typeof info?.mimetype === 'string' ? info.mimetype : MINDROOM_PASTE_TEXT_MIME_TYPE,
    size: typeof info?.size === 'number' ? info.size : undefined,
    encryptedFile,
  };
};

export const parseMindroomPasteMarker = (text: string): MindroomPasteMarker | undefined => {
  const trimmed = text.trim();
  if (
    !trimmed.startsWith(MINDROOM_PASTE_MARKER_START) ||
    !trimmed.endsWith(MINDROOM_PASTE_MARKER_END)
  ) {
    return undefined;
  }

  const json = trimmed.slice(MINDROOM_PASTE_MARKER_START.length, -MINDROOM_PASTE_MARKER_END.length);

  try {
    const payload = JSON.parse(json) as {
      chars?: unknown;
      file?: unknown;
      id?: unknown;
      v?: unknown;
    };
    if (payload.v !== MINDROOM_PASTE_MARKER_VERSION) return undefined;
    return markerFromParts({
      id: payload.id,
      chars: payload.chars,
      fileName: payload.file,
      raw: trimmed,
    });
  } catch {
    return undefined;
  }
};

export const findMindroomPasteMarkersInText = (text: string): MindroomPasteMarkerMatch[] => {
  const matches: MindroomPasteMarkerMatch[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const startIndex = text.indexOf(MINDROOM_PASTE_MARKER_START, cursor);
    if (startIndex === -1) break;

    const endIndex = text.indexOf(
      MINDROOM_PASTE_MARKER_END,
      startIndex + MINDROOM_PASTE_MARKER_START.length
    );
    if (endIndex === -1) break;

    const raw = text.slice(startIndex, endIndex + MINDROOM_PASTE_MARKER_END.length);
    const marker = parseMindroomPasteMarker(raw);
    if (marker) {
      matches.push({
        marker,
        index: startIndex,
        length: raw.length,
      });
    }
    cursor = endIndex + MINDROOM_PASTE_MARKER_END.length;
  }

  return matches;
};

export const formatMindroomPasteMarkerAsHtml = (marker: MindroomPasteMarker): string =>
  [
    '<span data-mindroom-paste-marker="true"',
    ` data-mindroom-paste-id="${escapeHtmlText(marker.id)}"`,
    ` data-mindroom-paste-chars="${marker.chars}"`,
    ` data-mindroom-paste-file="${escapeHtmlText(marker.fileName)}">`,
    escapeHtmlText(marker.raw),
    '</span>',
  ].join('');

export const createMindroomPasteAttachment = (
  pastedText: string,
  options: CreateMindroomPasteAttachmentOptions = {}
): MindroomPasteAttachment => {
  const id = options.id ?? createMindroomPasteId();
  const fileName = getMindroomPasteFileName(id);
  const marker = createMindroomPasteMarker({
    id,
    chars: pastedText.length,
    fileName,
  });

  return {
    id,
    marker,
    file: new File([pastedText], fileName, { type: MINDROOM_PASTE_TEXT_MIME_TYPE }),
  };
};

export const formatMindroomPasteMarkerTextAsHtml = (text: string): string | undefined => {
  let hasPasteMarker = false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const htmlLines = lines.flatMap((line) => {
    let cursor = 0;
    let html = '';

    findMindroomPasteMarkersInText(line).forEach(({ marker, index, length }) => {
      hasPasteMarker = true;
      html += escapeHtmlText(line.slice(cursor, index));
      html += formatMindroomPasteMarkerAsHtml(marker);
      cursor = index + length;
    });

    html += escapeHtmlText(line.slice(cursor));
    return html.trim() === '' ? [] : [`<p>${html}</p>`];
  });

  return hasPasteMarker ? htmlLines.join('') : undefined;
};
