import type { EventAttachmentOwner } from './eventAttachments';
import { IEncryptedFile } from '../../../types/matrix/common';

const LONG_TEXT_TAG = 'io.mindroom.long_text';
const LONG_TEXT_V2_ENCODING = 'matrix_event_content_json';
const TOOL_TRACE_TAG = 'io.mindroom.tool_trace';
const MAIN_EVENT_SNAPSHOT_KEY = '<== MAIN_EVENT ==>';
const REPLACEMENT_EVENT_SNAPSHOT_KEY_REG = /^<== REPLACEMENT_EVENT_(\d+) ==>$/;

let mindroomLongTextHydrationCache = new WeakMap<object, Map<string, Record<string, unknown>>>();
// In-flight downloads, coalesced per (owner, identity): the prewarm pool and
// any number of concurrently mounting rows share ONE fetch per sidecar
// instead of racing duplicates (the prewarm effect restarts on every
// threadEvents update while prior fetches are still in flight). Entries are
// removed on settle, so a failed fetch stays retryable — only completed
// parses are cached.
let mindroomLongTextInflight = new WeakMap<
  object,
  Map<string, Promise<Record<string, unknown> | undefined>>
>();

export type MindroomLongTextSource = {
  owner?: EventAttachmentOwner;
  previewContent: Record<string, unknown>;
  mxcUri: string;
  encryptedFile?: IEncryptedFile;
  isV2ContentJson: boolean;
};

export type MindroomLongTextSidecarTextLoader = (source: MindroomLongTextSource) => Promise<string>;

export const getMindroomLongTextSourceIdentity = (source: MindroomLongTextSource): string =>
  JSON.stringify({
    encryptedFile: source.encryptedFile,
    isV2ContentJson: source.isV2ContentJson,
    mxcUri: source.mxcUri,
  });

const getMindroomLongTextCache = (owner: object): Map<string, Record<string, unknown>> => {
  const existing = mindroomLongTextHydrationCache.get(owner);
  if (existing) return existing;

  const cache = new Map<string, Record<string, unknown>>();
  mindroomLongTextHydrationCache.set(owner, cache);
  return cache;
};

const getMindroomLongTextInflight = (
  owner: object
): Map<string, Promise<Record<string, unknown> | undefined>> => {
  const existing = mindroomLongTextInflight.get(owner);
  if (existing) return existing;

  const inflight = new Map<string, Promise<Record<string, unknown> | undefined>>();
  mindroomLongTextInflight.set(owner, inflight);
  return inflight;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

const asEncryptedFile = (value: unknown): IEncryptedFile | undefined => {
  if (!isRecord(value) || !isMxc(value.url)) return undefined;
  return value as unknown as IEncryptedFile;
};

const isMindroomLongTextV2Meta = (meta: unknown): boolean =>
  isRecord(meta) && meta.version === 2 && meta.encoding === LONG_TEXT_V2_ENCODING;

const looksLikeMessageContent = (value: Record<string, unknown>): boolean => {
  if (
    typeof value.msgtype === 'string' ||
    typeof value.body === 'string' ||
    typeof value.formatted_body === 'string'
  ) {
    return true;
  }

  const newContent = isRecord(value['m.new_content'])
    ? (value['m.new_content'] as Record<string, unknown>)
    : undefined;
  if (!newContent) return false;

  return (
    typeof newContent.msgtype === 'string' ||
    typeof newContent.body === 'string' ||
    typeof newContent.formatted_body === 'string'
  );
};

const asMessageContent = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  return looksLikeMessageContent(value) ? value : undefined;
};

const getEventContentFromRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;

  const replacementContent =
    isRecord(value.unsigned) &&
    isRecord(value.unsigned['m.relations']) &&
    isRecord(value.unsigned['m.relations']['m.replace'])
      ? value.unsigned['m.relations']['m.replace'].content
      : undefined;

  return asMessageContent(replacementContent) ?? asMessageContent(value.content);
};

const extractMessageContentFromSidecarPayload = (
  payload: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const directContent = asMessageContent(payload) ?? asMessageContent(payload.content);
  if (directContent) return directContent;

  const replacementEventCandidates = Object.entries(payload)
    .map(([key, value]) => {
      const match = key.match(REPLACEMENT_EVENT_SNAPSHOT_KEY_REG);
      if (!match) return undefined;
      return {
        sequence: Number(match[1]),
        content: getEventContentFromRecord(value),
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        sequence: number;
        content: Record<string, unknown> | undefined;
      } => candidate !== undefined
    )
    .sort((a, b) => b.sequence - a.sequence);

  const replacementContent = replacementEventCandidates
    .map((candidate) => candidate.content)
    .find((candidate): candidate is Record<string, unknown> => candidate !== undefined);
  if (replacementContent) return replacementContent;

  return getEventContentFromRecord(payload[MAIN_EVENT_SNAPSHOT_KEY]);
};

const getLongTextCandidates = (content: Record<string, unknown>): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  return newContent ? [newContent, content] : [content];
};

export const hasMindroomLongTextMetadata = (content: Record<string, unknown>): boolean =>
  getLongTextCandidates(content).some((candidate) => isRecord(candidate[LONG_TEXT_TAG]));

const getLongTextSourceFromCandidate = (
  previewContent: Record<string, unknown>
): MindroomLongTextSource | undefined => {
  const meta = previewContent[LONG_TEXT_TAG];
  if (!isMindroomLongTextV2Meta(meta)) return undefined;

  const encryptedFile = asEncryptedFile(previewContent.file);
  const mxcUri = encryptedFile?.url ?? (isMxc(previewContent.url) ? previewContent.url : undefined);

  if (!mxcUri) return undefined;

  return {
    previewContent,
    mxcUri,
    encryptedFile,
    isV2ContentJson: true,
  };
};

export const withMindroomToolTraceFallback = (
  content: Record<string, unknown>,
  ...fallbackSources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> => {
  if (content[TOOL_TRACE_TAG] !== undefined) return content;

  const fallbackSource = fallbackSources.find((source) => source?.[TOOL_TRACE_TAG] !== undefined);
  if (!fallbackSource) return content;

  return {
    ...content,
    [TOOL_TRACE_TAG]: fallbackSource[TOOL_TRACE_TAG],
  };
};

export const clearMindroomLongTextHydrationCache = () => {
  mindroomLongTextHydrationCache = new WeakMap();
  mindroomLongTextInflight = new WeakMap();
};

/** How a long text was read from its sidecar file; MindRoom's own reader is stricter than Chat's. */
export type MindroomLongTextSidecarFacts = {
  /** The file was the message content itself, the only shape MindRoom reads. */
  topLevelContent: boolean;
  bytes: number;
};

const SIDECAR_FACTS = Symbol('mindroomLongTextSidecarFacts');

export const getMindroomLongTextSidecarFacts = (
  content: Record<string, unknown>
): MindroomLongTextSidecarFacts | undefined =>
  (content as Record<symbol, MindroomLongTextSidecarFacts | undefined>)[SIDECAR_FACTS];

export const parseMindroomLongTextJsonSidecar = (
  rawSidecar: string
): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(rawSidecar);
    if (!isRecord(parsed)) return undefined;
    const content = extractMessageContentFromSidecarPayload(parsed);
    if (content) {
      // Not enumerable, so the facts never reach rendering, copies, or JSON.
      Object.defineProperty(content, SIDECAR_FACTS, {
        value: {
          topLevelContent: content === parsed,
          bytes: new TextEncoder().encode(rawSidecar).length,
        } satisfies MindroomLongTextSidecarFacts,
      });
    }
    return content;
  } catch {
    return undefined;
  }
};

const normalizeHydratedMindroomContent = (
  hydratedContent: Record<string, unknown>
): Record<string, unknown> => {
  if (!isRecord(hydratedContent['m.new_content'])) return hydratedContent;

  const newContent = hydratedContent['m.new_content'] as Record<string, unknown>;
  const newContentHasMessageShape =
    typeof newContent.msgtype === 'string' ||
    typeof newContent.body === 'string' ||
    typeof newContent.formatted_body === 'string';

  if (!newContentHasMessageShape) return hydratedContent;

  const normalizedContent: Record<string, unknown> = { ...newContent };

  Object.entries(hydratedContent).forEach(([key, value]) => {
    if (normalizedContent[key] !== undefined) return;
    if (key === 'm.mentions' || key.startsWith('io.mindroom.') || key.startsWith('com.mindroom.')) {
      normalizedContent[key] = value;
    }
  });

  if (typeof normalizedContent.body !== 'string' && typeof hydratedContent.body === 'string') {
    normalizedContent.body = hydratedContent.body;
  }
  if (
    typeof normalizedContent.formatted_body !== 'string' &&
    typeof hydratedContent.formatted_body === 'string'
  ) {
    normalizedContent.formatted_body = hydratedContent.formatted_body;
  }
  if (
    typeof normalizedContent.msgtype !== 'string' &&
    typeof hydratedContent.msgtype === 'string'
  ) {
    normalizedContent.msgtype = hydratedContent.msgtype;
  }

  return normalizedContent;
};

export const getMindroomLongTextSource = (
  content: Record<string, unknown>
): MindroomLongTextSource | undefined => {
  const candidates = getLongTextCandidates(content);
  for (const candidate of candidates) {
    const source = getLongTextSourceFromCandidate(candidate);
    if (!source) continue;

    return {
      ...source,
      previewContent:
        candidate === content
          ? source.previewContent
          : withMindroomToolTraceFallback(source.previewContent, content),
    };
  }
  return undefined;
};

export const getMindroomLongTextMxcUri = (content: Record<string, unknown>): string | undefined =>
  getMindroomLongTextSource(content)?.mxcUri;

/**
 * Plaintext budget for content sent as one event. Encryption grows an event by about a third, so
 * larger content is sent as a long-text sidecar instead, to stay under Matrix's 64 KiB event limit.
 */
export const MAX_EVENT_CONTENT_BYTES = 40_000;

export const contentBytes = (content: object): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;

/** Ends the preview of a message sent as a long-text sidecar, as MindRoom's own long replies do. */
export const LONG_TEXT_CONTINUATION_NOTE = '\n\n[Message continues in attached file]';

// Enough to read in a notification or a client that does not download the file.
const MESSAGE_PREVIEW_LENGTH = 2000;

/**
 * The event for a typed message sent as a long-text sidecar: the start of its text, and the
 * mentions and relation that route it. The file holds the whole message.
 */
export const buildMindroomLongTextPreview = (content: Record<string, unknown>) => {
  const body = typeof content.body === 'string' ? content.body : '';
  // Cut between characters, never inside a surrogate pair.
  const start = body.slice(0, MESSAGE_PREVIEW_LENGTH).replace(/[\uD800-\uDBFF]$/, '');
  return {
    body: `${start}${LONG_TEXT_CONTINUATION_NOTE}`,
    ...(content['m.mentions'] === undefined ? {} : { 'm.mentions': content['m.mentions'] }),
    ...(content['m.relates_to'] === undefined ? {} : { 'm.relates_to': content['m.relates_to'] }),
  };
};

/**
 * Marks a preview as a v2 long-text sidecar, as MindRoom's backend writes them: the event is a
 * short `m.file` preview, and the file it points at holds the message's whole content as JSON.
 */
export const withMindroomLongTextSidecarMetadata = (
  preview: Record<string, unknown> & { body: string },
  originalSize: number
): Record<string, unknown> => ({
  ...preview,
  [LONG_TEXT_TAG]: {
    version: 2,
    encoding: LONG_TEXT_V2_ENCODING,
    original_event_size: originalSize,
    preview_size: preview.body.length,
    is_complete_content: true,
  },
});

export const getCachedMindroomLongTextContent = (
  source: MindroomLongTextSource,
  cacheOwner: object
): Record<string, unknown> | undefined =>
  getMindroomLongTextCache(cacheOwner).get(getMindroomLongTextSourceIdentity(source));

export const hydrateMindroomLongTextSource = async (
  source: MindroomLongTextSource,
  loadSidecarText: MindroomLongTextSidecarTextLoader,
  cacheOwner: object,
  isCurrent: () => boolean = () => true
): Promise<Record<string, unknown>> => {
  if (!isCurrent()) return source.previewContent;
  const cached = getCachedMindroomLongTextContent(source, cacheOwner);
  if (cached) return cached;

  const identity = getMindroomLongTextSourceIdentity(source);
  const inflight = getMindroomLongTextInflight(cacheOwner);
  const pending = inflight.get(identity);

  const download =
    pending ??
    (async () => {
      try {
        // The loader must not run before the in-flight entry is registered:
        // this async body executes synchronously up to its first await, so a
        // SYNCHRONOUS loader throw would settle the promise — and run the
        // finally-cleanup — before inflight.set below, pinning an
        // already-resolved preview promise in the map forever.
        const sidecarText = await Promise.resolve().then(() => loadSidecarText(source));
        const hydratedContent = parseMindroomLongTextJsonSidecar(sidecarText);
        if (!hydratedContent) return undefined;
        return normalizeHydratedMindroomContent(hydratedContent);
      } catch {
        return undefined;
      } finally {
        inflight.delete(identity);
      }
    })();
  inflight.set(identity, download);
  // Shared parsing does not share publication authority between room consumers.
  const content = await download;
  if (!isCurrent() || !content) return source.previewContent;
  getMindroomLongTextCache(cacheOwner).set(identity, content);
  return content;
};
