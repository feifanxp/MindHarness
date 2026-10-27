import { sanitizeCustomHtml } from '../../utils/sanitize';
import {
  MINDROOM_TOOL_REF_ICON,
  formatMindroomMessageTextBodyAsHtml,
  parseMindroomToolRefText,
  type MindroomToolRefParseResult,
} from './blocks';
import { countMindroomToolRefIcons, getRenderedMindroomToolRefs } from './toolRefDom';
import {
  getMindroomToolTraceEvents,
  isMindroomToolTraceV2,
  type MindroomToolTraceEvent,
} from './toolTrace';

const COPY_TEXT_MSGTYPES = new Set(['m.text', 'm.notice', 'm.emote']);
const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';
const LONG_TEXT_KEY = 'io.mindroom.long_text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asTraceText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined;

export const isCopyTextMessageContent = (content: Record<string, unknown>): boolean =>
  typeof content.msgtype === 'string' && COPY_TEXT_MSGTYPES.has(content.msgtype);

export type MessageCopyTextSource = {
  body: string;
  /** The HTML rendered alongside `body`, when the sender provided one. */
  formattedBody?: string;
  /**
   * Whether to derive tool blocks for a body without HTML from the plain-body
   * fallback. Only plain events use it. Hydrated long text renders as plain
   * text, and long-text previews use a Markdown fallback that copy does not mirror,
   * so their markers stay in the copy.
   */
  plainBodyFallback: boolean;
  toolTraceEvents?: MindroomToolTraceEvent[];
};

const getNewContent = (
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined =>
  isRecord(content?.['m.new_content'])
    ? (content?.['m.new_content'] as Record<string, unknown>)
    : undefined;

export const getMessageCopyTextSource = (
  content: Record<string, unknown>,
  originalContent: Record<string, unknown>,
  resolvedLongTextContent?: Record<string, unknown>
): MessageCopyTextSource | undefined => {
  // Ordered by preference: hydrated long text first, then the latest edit,
  // then the original event. Like the renderer, hydrated long text keeps its
  // own trace instead of borrowing the envelope's.
  const families = [
    [resolvedLongTextContent, getNewContent(resolvedLongTextContent)].filter(isRecord),
    [content, getNewContent(content), originalContent].filter(isRecord),
  ];
  const family = families.find((candidates) =>
    candidates.some((candidate) => asNonEmptyString(candidate.body))
  );
  const bodySource = family?.find((candidate) => asNonEmptyString(candidate.body));
  if (!family || !bodySource) return undefined;

  const traceSource = [bodySource, ...family].find(
    (candidate) => candidate[TOOL_TRACE_KEY] !== undefined
  );

  return {
    body: bodySource.body as string,
    formattedBody:
      typeof bodySource.formatted_body === 'string' ? bodySource.formatted_body : undefined,
    plainBodyFallback:
      family === families[1] && !family.some((candidate) => candidate[LONG_TEXT_KEY] !== undefined),
    toolTraceEvents:
      traceSource && isMindroomToolTraceV2(traceSource)
        ? getMindroomToolTraceEvents(traceSource)
        : undefined,
  };
};

const splitLines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

export type MindroomToolMarkerScan = {
  lines: string[];
  toolRefs: Array<MindroomToolRefParseResult | undefined>;
};

/**
 * Find the body's tool-marker lines, but only when they provably are exactly
 * the tool blocks the renderer displays. Every 🔧 in the rendered text must sit
 * in a tool block, every 🔧 in the body on a marker line, and the two must match
 * one to one. Then no marker line can also render as visible text, whatever
 * code, math, quotes, or spelling surround it. Anything else copies the body
 * unchanged.
 *
 * Takes plain strings so callers can memoize this, the expensive step.
 */
export const scanMindroomToolMarkerLines = (
  body: string,
  formattedBody: string | undefined,
  plainBodyFallback: boolean
): MindroomToolMarkerScan | undefined => {
  if (!body.includes(MINDROOM_TOOL_REF_ICON)) return undefined;

  // Mirror the renderer, which sanitizes formatted_body or its plain-body fallback.
  const rawHtml =
    formattedBody ?? (plainBodyFallback ? formatMindroomMessageTextBodyAsHtml(body) : undefined);
  if (!rawHtml) return undefined;
  const html = sanitizeCustomHtml(rawHtml);

  const { toolBlocks, iconCount, toolBlockIconCount } = getRenderedMindroomToolRefs(html);
  if (toolBlocks.length === 0 || iconCount !== toolBlockIconCount) return undefined;
  const displayed = new Map(toolBlocks.map((toolBlock) => [toolBlock.index, toolBlock]));
  if (displayed.size !== toolBlocks.length) return undefined;

  const lines = splitLines(body);
  const toolRefs = lines.map((line) =>
    line.includes(MINDROOM_TOOL_REF_ICON) ? parseMindroomToolRefText(line) : undefined
  );
  const markers = toolRefs.filter((toolRef): toolRef is MindroomToolRefParseResult => !!toolRef);
  const markerIconCount = lines.reduce(
    (count, line, index) => (toolRefs[index] ? count + countMindroomToolRefIcons(line) : count),
    0
  );
  if (
    markers.length !== toolBlocks.length ||
    new Set(markers.map(({ index }) => index)).size !== markers.length ||
    // The pending ⏳ must be part of the block too, not left behind as text.
    markers.some(
      ({ index, toolName, pending }) =>
        displayed.get(index)?.toolName !== toolName || displayed.get(index)?.pending !== pending
    ) ||
    countMindroomToolRefIcons(body) !== markerIconCount
  ) {
    return undefined;
  }
  return { lines, toolRefs };
};

type ToolMarkerLineVisitor = (toolRef: MindroomToolRefParseResult) => string[];

/**
 * Replace marker lines with `visit`'s lines. Blank lines around a marker
 * collapse so it never leaves a gap wider than one blank line, and a marker
 * between two text lines still separates them.
 */
const replaceToolMarkerLines = (
  { lines, toolRefs }: MindroomToolMarkerScan,
  visit: ToolMarkerLineVisitor
): string => {
  const output: string[] = [];
  let separateNextBlock = false;
  const lastLineIsBlank = () => output.length === 0 || output[output.length - 1].trim() === '';

  lines.forEach((line, index) => {
    const toolRef = toolRefs[index];
    if (toolRef) {
      // The backend pads markers with blank lines on top of the reply's own, so
      // the gap before a marker can be several blank lines wide.
      while (output.length > 0 && output[output.length - 1].trim() === '') output.pop();
      const replacement = visit(toolRef);
      if (replacement.length > 0) {
        if (!lastLineIsBlank()) output.push('');
        output.push(...replacement);
      }
      separateNextBlock = true;
      return;
    }

    if (separateNextBlock) {
      if (line.trim() === '') return;
      if (!lastLineIsBlank()) output.push('');
      separateNextBlock = false;
    }

    output.push(line);
  });

  while (output.length > 0 && output[0].trim() === '') output.shift();
  while (output.length > 0 && output[output.length - 1].trim() === '') output.pop();
  return output.join('\n');
};

const stripMindroomToolMarkerLines = (scan: MindroomToolMarkerScan): string =>
  replaceToolMarkerLines(scan, () => []);

// Keep indentation inside previews; only drop surrounding blank lines.
const asTraceCodeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const lines = splitLines(value);
  while (lines[0].trim() === '') lines.shift();
  while (lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((line) => line.trimEnd()).join('\n');
};

const toFencedCodeBlock = (text: string): string[] => {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return [fence, ...text.split('\n'), fence];
};

// The copied Markdown stays English so pasted transcripts read the same
// regardless of the copier's interface language.
const formatToolCallMarkdown = (
  toolRef: MindroomToolRefParseResult,
  event: MindroomToolTraceEvent | undefined
): string[] => {
  const toolName = asTraceText(event?.tool_name) ?? toolRef.toolName;
  const argsPreview = asTraceCodeText(event?.args_preview);
  const resultPreview = asTraceCodeText(event?.result_preview);
  const traceType = asTraceText(event?.type);

  const notes: string[] = [];
  if (
    traceType === 'tool_call_started' ||
    (traceType !== 'tool_call_completed' && toolRef.pending)
  ) {
    notes.push('running');
  }
  if (!event) notes.push('details unavailable');
  if (event?.truncated === true) notes.push('preview truncated');

  const heading = `**${MINDROOM_TOOL_REF_ICON} Tool call ${toolRef.index}${
    notes.length > 0 ? ` (${notes.join(', ')})` : ''
  }**`;
  const command = argsPreview ? `${toolName}(${argsPreview})` : toolName;
  const lines = [heading, '', ...toFencedCodeBlock(command)];
  if (resultPreview) lines.push('', 'Result:', '', ...toFencedCodeBlock(resultPreview));
  return lines;
};

const expandMindroomToolMarkerLines = (
  scan: MindroomToolMarkerScan,
  toolTraceEvents: MindroomToolTraceEvent[] | undefined
): string =>
  replaceToolMarkerLines(scan, (toolRef) =>
    formatToolCallMarkdown(toolRef, toolTraceEvents?.[toolRef.index - 1])
  );

export type MessageCopyTexts = {
  text: string;
  /** Only present when it differs from `text`. */
  textWithToolCalls?: string;
};

/**
 * Copy texts for one message from its `scanMindroomToolMarkerLines` result;
 * bodies without displayed markers copy as-is.
 */
export const getMessageCopyTexts = (
  source: MessageCopyTextSource,
  scan: MindroomToolMarkerScan | undefined
): MessageCopyTexts => {
  if (!scan) return { text: source.body };

  const textWithToolCalls = expandMindroomToolMarkerLines(scan, source.toolTraceEvents);
  // A reply made only of tool calls copies those calls instead of nothing.
  const text = stripMindroomToolMarkerLines(scan);
  return text ? { text, textWithToolCalls } : { text: textWithToolCalls };
};
