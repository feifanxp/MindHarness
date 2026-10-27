import { MsgType } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { TFunction } from 'i18next';
import { getMemberDisplayName, trimReplyFromBody } from '../../utils/room';
import { isVoiceMessageContent } from '../../utils/voiceMessage';
import { readCanvasNoticeTitle } from '../ui-actions/chatUiProtocol';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfill';

export const VOICE_MESSAGE_PREVIEW_TEXT = 'Voice message';

// MindRoom serializes each tool call into the plain-text body as a
// standalone "🔧 `tool_name` [n]" line, with a trailing ⏳ while the call is
// still running (mindroom tool_system/events.py). Only root lines outside
// fences count; indented examples and a wrench + code span in prose stay prose.
const TOOL_CALL_MARKER_REGEX = /^🔧[^\S\n]*`[^`\n]+`[^\S\n]*\[\d+\](?:[^\S\n]*⏳)?[^\S\n]*$/u;

const mapPreviewLines = (
  body: string,
  mapLine: (line: string, context: 'prose' | 'code' | 'fence') => string
): string => {
  let fence: string | undefined;
  const lines = body.split(/\r?\n/).map((line) => {
    const match = fence
      ? /^(`{3,})( *)$/.exec(line) ?? /^ {0,3}(~{3,})([ \t]*)$/.exec(line)
      : /^(`{3,})(?!`)(\S*)$/.exec(line) ?? /^ {0,3}(~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        match &&
        match[1][0] === fence[0] &&
        // Backticks mirror CodeBlockRule's exact-length closing grammar;
        // tilde fences remain a conservative preview-only boundary.
        (fence[0] === '`' ? match[1] === fence : match[1].length >= fence.length)
      ) {
        fence = undefined;
        return mapLine(line, 'fence');
      }
      return mapLine(line, 'code');
    }
    if (match) {
      // The message parser accepts backticks in info strings. Keep examples
      // protected here too, including conservative unmatched-fence handling.
      fence = match[1];
      return mapLine(line, 'fence');
    }
    return mapLine(line, 'prose');
  });
  return lines.join('\n');
};

const extractPreviewTools = (body: string): { body: string; toolCallCount: number } => {
  let toolCallCount = 0;
  const text = mapPreviewLines(body, (line, context) => {
    if (context !== 'prose' || !TOOL_CALL_MARKER_REGEX.test(line)) return line;
    toolCallCount += 1;
    return ' ';
  });
  return { body: text, toolCallCount };
};

// Bound the text fed to the regex pipeline below: previews render as a single
// truncated line, and unbounded pathological bodies (e.g. tens of KB of "[")
// make the label/emphasis passes quadratic. Markers are counted and removed
// on the full body first with a linear line scan.
const PREVIEW_SOURCE_MAX_LENGTH = 2000;

const ORPHAN_SEPARATOR_EDGE_REGEX = /^[\s,;:·|]+|[\s,;:·|]+$/gu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const formatToolCallSummary = (count: number): string =>
  `🔧 ${count} ${count === 1 ? 'tool' : 'tools'}`;

// A GFM table's delimiter row carries no text, and its rows read as cells set
// apart by a middle dot. Only rows fenced by pipes count, so prose such as
// "a | b" stays as written. Fence lines drop out, as for any code block.
const TABLE_DELIMITER_ROW_REGEX = /^\|(?:\s*:?-+:?\s*\|)+$/;
const TABLE_ROW_REGEX = /^\|.*\|$/;

const previewLineText = (): ((line: string, context: 'prose' | 'code' | 'fence') => string) => {
  let inTable = false;
  return (line, context) => {
    const row = line.trim();
    if (context !== 'prose' || !TABLE_ROW_REGEX.test(row)) {
      inTable = false;
      return context === 'fence' ? ' ' : line;
    }
    if (TABLE_DELIMITER_ROW_REGEX.test(row)) return ' ';
    const cells = row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(' · ');
    const text = inTable ? `· ${cells}` : cells;
    inTable = true;
    return text;
  };
};

// One-line previews render markdown source as-is, so strip the syntax down to
// its text. Underscore emphasis (_x_, __x__) is intentionally left alone: in
// agent chat bare underscores are far more likely to be identifiers like
// snake_case or __init__ than emphasis, and LLM output uses asterisks.
export const stripPreviewMarkdown = (value: string): string =>
  mapPreviewLines(
    value
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*(?:>\s?)+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d{1,3}[.)]\s+/gm, '')
      // Indentation is presentation-only in this single-line result. Normalize
      // it after counting tools so nested code boundaries can also be stripped.
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n'),
    previewLineText()
  )
    // Destinations may contain one level of balanced parens, e.g.
    // https://en.wikipedia.org/wiki/Foo_(bar). The inner alternation consumes
    // one char or one balanced group per step (no ambiguity, no exponential
    // backtracking); PREVIEW_SOURCE_MAX_LENGTH bounds the quadratic worst
    // case of the label scans.
    .replace(/!\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
    // Like the italic rule below, require non-word flanking so ** operators in
    // code (x**2 + y**2) are never paired as bold.
    .replace(/(^|[^\w*])\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ' ');

export type ThreadPreviewLocalization =
  | { kind: 'voice' | 'audio' | 'image' | 'video' | 'file' }
  | { kind: 'tools'; count: number; prose: string };

/** Preview text and, for generated copy such as the tool badge, where it came from. */
type ThreadPreview = {
  text: string | undefined;
  localization: ThreadPreviewLocalization | undefined;
};

const NO_PREVIEW: ThreadPreview = { text: undefined, localization: undefined };

const computeBodyPreview = (body: string): ThreadPreview => {
  const withoutReply = trimReplyFromBody(body);
  const { body: withoutToolMarkers, toolCallCount } = extractPreviewTools(withoutReply);
  const boundedSource =
    withoutToolMarkers.length > PREVIEW_SOURCE_MAX_LENGTH
      ? // Drop a split-off lone high surrogate at the cut point.
        withoutToolMarkers.slice(0, PREVIEW_SOURCE_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '')
      : withoutToolMarkers;
  const prose = stripPreviewMarkdown(boundedSource).replace(/\s+/g, ' ').trim();

  if (toolCallCount > 0) {
    const cleanedProse = prose.replace(ORPHAN_SEPARATOR_EDGE_REGEX, '');
    // Downstream streaming-repair checks (compactThreadRootData,
    // threadOverviewCacheHydration) run hasLikelyIncompleteStreamingBody on
    // this preview text; prefixing the badge would hide the "Thinking" prefix
    // they match on, so pass the placeholder through unbadged.
    if (hasLikelyIncompleteStreamingBody(cleanedProse)) {
      return { text: cleanedProse, localization: undefined };
    }
    const badgeProse = /[\p{L}\p{N}]/u.test(cleanedProse) ? cleanedProse : '';
    const badge = formatToolCallSummary(toolCallCount);
    return {
      text: badgeProse ? `${badge} · ${badgeProse}` : badge,
      localization: { kind: 'tools', count: toolCallCount, prose: badgeProse },
    };
  }

  return { text: prose.length > 0 ? prose : undefined, localization: undefined };
};

// Thread records, cross-room index entries and the minimap preview the root
// and latest replies of every thread on each rebuild. The analysis depends
// only on the body, so a least-recently-used cache sized above one large
// room's working set (523 threads) reuses it across rebuilds. The character
// budget bounds the strings it can keep alive.
const BODY_PREVIEW_CACHE_MAX_ENTRIES = 5000;
const BODY_PREVIEW_CACHE_MAX_CHARS = 4_000_000;
const bodyPreviewCache = new Map<string, ThreadPreview>();
let bodyPreviewCacheChars = 0;

const analyzeBodyPreview = (body: string): ThreadPreview => {
  const cached = bodyPreviewCache.get(body);
  if (cached) {
    // Map iteration follows insertion order, so re-inserting marks it recent.
    bodyPreviewCache.delete(body);
    bodyPreviewCache.set(body, cached);
    return cached;
  }

  const analysis = computeBodyPreview(body);
  bodyPreviewCache.set(body, analysis);
  bodyPreviewCacheChars += body.length;
  for (const oldest of bodyPreviewCache.keys()) {
    if (
      bodyPreviewCache.size <= BODY_PREVIEW_CACHE_MAX_ENTRIES &&
      bodyPreviewCacheChars <= BODY_PREVIEW_CACHE_MAX_CHARS
    ) {
      break;
    }
    bodyPreviewCache.delete(oldest);
    bodyPreviewCacheChars -= oldest.length;
  }
  return analysis;
};

const getMediaFallbackPreview = (content: Record<string, unknown>): ThreadPreview | undefined => {
  switch (content.msgtype) {
    case MsgType.Audio:
      return { text: 'Audio', localization: { kind: 'audio' } };
    case MsgType.Image:
      return { text: 'Image', localization: { kind: 'image' } };
    case MsgType.Video:
      return { text: 'Video', localization: { kind: 'video' } };
    case MsgType.File:
      return { text: 'File', localization: { kind: 'file' } };
    default:
      return undefined;
  }
};

// The preview text and the origin of its generated copy come from one
// analysis, so a localized preview reads the body once.
const resolveThreadPreview = (
  content: Record<string, unknown> | null | undefined
): ThreadPreview => {
  if (!content || !isRecord(content)) return NO_PREVIEW;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const previewContent = newContent ? { ...content, ...newContent } : content;

  if (previewContent.msgtype === MsgType.Audio && isVoiceMessageContent(previewContent)) {
    return { text: VOICE_MESSAGE_PREVIEW_TEXT, localization: { kind: 'voice' } };
  }

  // A canvas request's body is the fallback for other Matrix clients; Chat names the canvas.
  const canvasTitle = readCanvasNoticeTitle(previewContent);
  if (canvasTitle) return { text: canvasTitle, localization: undefined };

  const bodyPreview =
    typeof previewContent.body === 'string' ? analyzeBodyPreview(previewContent.body) : undefined;
  if (bodyPreview?.text) return bodyPreview;

  return getMediaFallbackPreview(previewContent) ?? NO_PREVIEW;
};

export const getThreadMessagePreviewText = (
  content: Record<string, unknown> | null | undefined
): string | undefined => resolveThreadPreview(content).text;

/** Carry the origin of generated copy to the UI without translating user text or cached data. */
export const getThreadPreviewLocalization = (
  content: Record<string, unknown> | null | undefined,
  previewText: string | undefined
): ThreadPreviewLocalization | undefined => {
  if (!previewText) return undefined;
  const preview = resolveThreadPreview(content);
  return preview.text === previewText ? preview.localization : undefined;
};

export const localizeThreadPreview = (
  text: string | undefined,
  localization: ThreadPreviewLocalization | undefined,
  t?: TFunction
): string | undefined => {
  if (!localization || !t) return text;
  switch (localization.kind) {
    case 'voice':
      return t('sharedUi.threadPreviews.voiceMessage');
    case 'audio':
      return t('mindroomUi.message-search.searchResultPreview.audio');
    case 'image':
      return t('mindroomUi.message-search.searchResultPreview.image');
    case 'video':
      return t('mindroomUi.message-search.searchResultPreview.video');
    case 'file':
      return t('mindroomUi.message-search.searchResultPreview.file');
    case 'tools': {
      const badge = `🔧 ${t('sharedUi.threadPreviews.tools', { count: localization.count })}`;
      return localization.prose ? `${badge} · ${localization.prose}` : badge;
    }
    default:
      return text;
  }
};

export const getLocalizedThreadMessagePreviewText = (
  content: Record<string, unknown> | null | undefined,
  t?: TFunction
): string | undefined => {
  const { text, localization } = resolveThreadPreview(content);
  return localizeThreadPreview(text, localization, t);
};

const MATRIX_USER_ID_CANDIDATE_REGEXP = /@[^\s:]+:\S+/g;
const MATRIX_USER_ID_TRAILING_PUNCTUATION_REGEXP = /[.,!?;:)\]}'"`*_~>]+$/;

// MindRoom agents mention users by full Matrix ID in the plain body (the
// formatted body carries the pill), so previews built from the body name room
// members instead. `prefix` adds the `@` that a mention pill shows.
export const replaceMatrixUserIdsWithDisplayNames = (
  room: Room,
  text: string,
  prefix = ''
): string =>
  text.replace(MATRIX_USER_ID_CANDIDATE_REGEXP, (candidate) => {
    const exactDisplayName = getMemberDisplayName(room, candidate);
    if (exactDisplayName) return `${prefix}${exactDisplayName}`;

    const trailingPunctuation =
      candidate.match(MATRIX_USER_ID_TRAILING_PUNCTUATION_REGEXP)?.[0] ?? '';
    for (let length = 1; length <= trailingPunctuation.length; length += 1) {
      const userId = candidate.slice(0, -length);
      const displayName = getMemberDisplayName(room, userId);
      if (displayName) return `${prefix}${displayName}${candidate.slice(-length)}`;
    }

    return candidate;
  });

/** The one-line preview of a quoted reply, with mentions read as their pills. */
export const getReplyPreviewText = (
  room: Room,
  content: Record<string, unknown> | null | undefined,
  t?: TFunction
): string | undefined => {
  const text = getLocalizedThreadMessagePreviewText(content, t);
  return text && replaceMatrixUserIdsWithDisplayNames(room, text, '@');
};
