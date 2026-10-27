import { MsgType } from 'matrix-js-sdk';
import { sanitizeText } from '../../utils/sanitize';
import {
  contentBytes,
  LONG_TEXT_CONTINUATION_NOTE,
  MAX_EVENT_CONTENT_BYTES,
} from '../messages/longText';
import { getMessageRelation } from '../threads/composeMessageRelation';
import {
  CANVAS_ERROR_MESSAGE,
  CANVAS_STATE_MAX_LENGTH,
  CANVAS_STATE_MESSAGE,
  CANVAS_SUBMIT_MESSAGE,
  type CanvasSaved,
} from './canvasDocument';

export const CANVAS_RESPONSE_KEY = 'io.mindroom.canvas_response';

// An answer too large for one event travels as a long-text sidecar, which MindRoom downloads up to
// 2 MiB; escaped into the body and repeated in the metadata, the data can take about three times
// its own size there.
const MAX_DATA_BYTES = 512 * 1024;
export const CANVAS_LABEL_MAX_LENGTH = 200;

export type CanvasSubmission = {
  data: unknown;
  label?: string;
};

export type CanvasTarget = {
  eventId: string;
  /** The edit (or the original request) whose document the user answered. */
  revisionEventId: string;
  agentUserId: string;
  agentName: string;
  threadId?: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Matrix canonical JSON: servers sort object keys and refuse numbers that are not safe integers
 * in unencrypted events. Sorting here keeps the body equal to the stored metadata.
 */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])])
  );
};

const serialize = (data: unknown): string | undefined => {
  try {
    const json = JSON.stringify(sortKeys(data));
    return typeof json === 'string' ? json : undefined;
  } catch {
    return undefined;
  }
};

/** Decimal and very large numbers travel as text, the only form every homeserver accepts. */
// A lone surrogate is not text: MindRoom refuses a long answer's file that holds one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const isText = (value: string): boolean => !LONE_SURROGATE.test(value);

// MindRoom gives up on very deep files; far deeper than any real answer, well short of its limit.
const MAX_TEXT_DEPTH = 1000;

/**
 * Whether every string and key in a value is valid text, as MindRoom requires of a long message's
 * file. Deeper nesting than MindRoom reads counts as not text, and the walk keeps its own stack.
 */
export const isAllText = (value: unknown): boolean => {
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length > 0) {
    const [item, depth] = pending.pop()!;
    if (typeof item === 'string') {
      if (!isText(item)) return false;
    } else if (Array.isArray(item) || record(item)) {
      if (depth >= MAX_TEXT_DEPTH) return false;
      for (const [key, element] of Object.entries(item)) {
        if (!Array.isArray(item) && !isText(key)) return false;
        pending.push([element, depth + 1]);
      }
    }
  }
  return true;
};

const matrixSafeData = (data: unknown): unknown =>
  JSON.parse(JSON.stringify(data), (key, value: unknown) => {
    if (!isText(key) || (typeof value === 'string' && !isText(value))) {
      throw new Error('Canvas answers must be valid text.');
    }
    return typeof value === 'number' && !Number.isSafeInteger(value) ? String(value) : value;
  });

/** Accept only the bridge message shape, from this canvas frame, within the payload budget. */
export const readCanvasSubmission = (
  event: MessageEvent,
  frame: Window | null | undefined
): CanvasSubmission | undefined => {
  if (!frame || event.source !== frame || event.origin !== 'null') return undefined;
  const message = event.data;
  if (!record(message) || message.type !== CANVAS_SUBMIT_MESSAGE || message.version !== 1) {
    return undefined;
  }
  if (
    message.label !== undefined &&
    (typeof message.label !== 'string' || !isText(message.label))
  ) {
    return undefined;
  }
  let data: unknown;
  try {
    data = matrixSafeData(message.data);
  } catch {
    return undefined;
  }
  const json = serialize(data);
  if (json === undefined || new TextEncoder().encode(json).length > MAX_DATA_BYTES) {
    return undefined;
  }
  // Cut between characters: half an emoji would make the answer's text invalid.
  const label = message.label
    ?.trim()
    .slice(0, CANVAS_LABEL_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, '');
  return { data: JSON.parse(json), ...(label ? { label } : {}) };
};

const responseSummary = (canvasEventId: string, revisionEventId: string, label: string) =>
  `Canvas response (${canvasEventId}, revision ${revisionEventId}): ${label}`;

const canonicalBody = (
  agentUserId: string,
  canvasEventId: string,
  revisionEventId: string,
  label: string,
  json: string
) => `${agentUserId} ${responseSummary(canvasEventId, revisionEventId, label)}\n${json}`;

/** The label the wire format uses for an answer without one; Chat shows a translated word instead. */
export const CANVAS_DEFAULT_LABEL = 'Submitted';

// A display name can be as long as a membership event allows; the mention pill needs only a name.
const MAX_MENTION_NAME_LENGTH = 100;
const mentionName = (name: string): string =>
  name.length > MAX_MENTION_NAME_LENGTH ? `${name.slice(0, MAX_MENTION_NAME_LENGTH - 1)}…` : name;

/** What every message to a canvas's agent shares: the mention pill and the reply to the canvas. */
const toCanvasAgent = (canvas: CanvasTarget) => ({
  mention: `<a href="https://matrix.to/#/${encodeURIComponent(canvas.agentUserId)}">${sanitizeText(
    mentionName(canvas.agentName)
  )}</a>`,
  // A reply to the canvas request always has a relation; this fallback only satisfies the type.
  relation: getMessageRelation(canvas.eventId, undefined, canvas.threadId) ?? {
    'm.in_reply_to': { event_id: canvas.eventId },
  },
});

/** What the page saved, and whether the user had clicked or typed in it (undefined where the browser cannot tell). */
export type CanvasStateMessage = { change: CanvasSaved; user?: boolean };

/** Accept the page state or the control values this canvas frame saves; both are written back into the page as is. */
export const readCanvasState = (
  event: MessageEvent,
  frame: Window | null | undefined
): CanvasStateMessage | undefined => {
  if (!frame || event.source !== frame || event.origin !== 'null') return undefined;
  const message = event.data;
  if (!record(message) || message.type !== CANVAS_STATE_MESSAGE || message.version !== 1) {
    return undefined;
  }
  const part = 'json' in message ? 'json' : 'inputs';
  const text = message[part];
  if (typeof text !== 'string' || text.length > CANVAS_STATE_MAX_LENGTH) return undefined;
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  const change = { [part]: text };
  return typeof message.user === 'boolean' ? { change, user: message.user } : { change };
};

/** One error line a canvas may report; longer ones are cut. */
const MAX_ERROR_LENGTH = 300;

/** Accept one error report from this canvas frame as a single line of text. */
export const readCanvasError = (
  event: MessageEvent,
  frame: Window | null | undefined
): string | undefined => {
  if (!frame || event.source !== frame || event.origin !== 'null') return undefined;
  const message = event.data;
  if (!record(message) || message.type !== CANVAS_ERROR_MESSAGE || message.version !== 1) {
    return undefined;
  }
  if (typeof message.message !== 'string') return undefined;
  // Only the start of a long message is read, so a page cannot make the host work on megabytes.
  const start = message.message.slice(0, 2 * MAX_ERROR_LENGTH).replace(/[\uD800-\uDBFF]$/, '');
  if (!isText(start)) return undefined;
  const text = start.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  // Cut between characters: half an emoji would make the report's text invalid.
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, '')}…`
    : text;
};

/** Errors the page reported, sent on the user's request as a mention in the canvas's conversation. */
export const buildCanvasErrorContent = (canvas: CanvasTarget, errors: string[]) => {
  const summary = `Canvas error (${canvas.eventId}, revision ${canvas.revisionEventId}):`;
  const lines = errors.join('\n');
  const { mention, relation } = toCanvasAgent(canvas);
  return {
    msgtype: MsgType.Text,
    body: `${canvas.agentUserId} ${summary}\n${lines}`,
    format: 'org.matrix.custom.html',
    formatted_body: `${mention} ${sanitizeText(summary)}<pre><code>${sanitizeText(
      lines
    )}</code></pre>`,
    'm.mentions': { user_ids: [canvas.agentUserId] },
    'm.relates_to': relation,
  };
};

/** A commit is an ordinary mention so the agent's existing turn pipeline receives it. */
export const buildCanvasResponseContent = (canvas: CanvasTarget, submission: CanvasSubmission) => {
  const label = submission.label ?? CANVAS_DEFAULT_LABEL;
  const json = serialize(submission.data) ?? 'null';
  const summary = responseSummary(canvas.eventId, canvas.revisionEventId, label);
  const { mention: pill, relation } = toCanvasAgent(canvas);
  const mention = `${pill} ${sanitizeText(summary)}`;
  const content = {
    msgtype: MsgType.Text,
    body: canonicalBody(canvas.agentUserId, canvas.eventId, canvas.revisionEventId, label, json),
    format: 'org.matrix.custom.html',
    formatted_body: `${mention}<pre><code>${sanitizeText(json)}</code></pre>`,
    'm.mentions': { user_ids: [canvas.agentUserId] },
    'm.relates_to': relation,
    [CANVAS_RESPONSE_KEY]: {
      version: 1,
      canvas_event_id: canvas.eventId,
      canvas_revision_event_id: canvas.revisionEventId,
      agent_user_id: canvas.agentUserId,
      ...(submission.label ? { label: submission.label } : {}),
      data: submission.data,
    },
  };
  // HTML escaping can multiply dense data; the plain body still carries the JSON for every client.
  return contentBytes(content) <= MAX_EVENT_CONTENT_BYTES
    ? content
    : { ...content, formatted_body: mention };
};

export type CanvasResponseContent = ReturnType<typeof buildCanvasResponseContent>;

/** MindRoom downloads a long message's file up to this size (`_MXC_TEXT_MAX_BYTES`). */
export const MINDROOM_SIDECAR_MAX_BYTES = 2 * 1024 * 1024;

/** Whether an answer fits one event; a larger one is sent as a long-text sidecar. */
export const canvasResponseFitsInEvent = (content: CanvasResponseContent): boolean =>
  contentBytes(content) <= MAX_EVENT_CONTENT_BYTES;

/**
 * The event for an answer sent as a long-text sidecar: the summary line, the mention and reply
 * that route it, and the answer's metadata without its data, which only the uploaded file carries.
 */
export const buildCanvasResponsePreview = (content: CanvasResponseContent) => {
  const { data: _data, ...marker } = content[CANVAS_RESPONSE_KEY];
  return {
    // Canonical JSON has no raw line break, so the last one ends the summary line. The note is the
    // one MindRoom's own long replies carry, for whoever sees only the preview.
    body: `${content.body.slice(0, content.body.lastIndexOf('\n'))}${LONG_TEXT_CONTINUATION_NOTE}`,
    'm.mentions': content['m.mentions'],
    'm.relates_to': content['m.relates_to'],
    [CANVAS_RESPONSE_KEY]: marker,
  };
};

export type CanvasResponseReceipt = {
  canvasEventId: string;
  /** Missing when the answer had no label; Chat shows a translated word instead. */
  label?: string;
  json: string;
};

/**
 * Chat shows a commit as a receipt; other clients and the agent read its body.
 * Only a body that says exactly what the metadata says may be replaced by the receipt.
 */
export const readCanvasResponse = (
  content: Record<string, unknown>
): CanvasResponseReceipt | undefined => {
  const response = content[CANVAS_RESPONSE_KEY];
  if (
    content.msgtype !== MsgType.Text ||
    typeof content.body !== 'string' ||
    !record(response) ||
    response.version !== 1 ||
    typeof response.canvas_event_id !== 'string' ||
    !response.canvas_event_id.startsWith('$') ||
    typeof response.agent_user_id !== 'string' ||
    typeof response.canvas_revision_event_id !== 'string' ||
    (response.label !== undefined && typeof response.label !== 'string')
  ) {
    return undefined;
  }
  const relation = content['m.relates_to'];
  const reply = record(relation) ? relation['m.in_reply_to'] : undefined;
  const mentions = content['m.mentions'];
  if (
    !record(reply) ||
    reply.event_id !== response.canvas_event_id ||
    !record(mentions) ||
    !Array.isArray(mentions.user_ids) ||
    !mentions.user_ids.includes(response.agent_user_id)
  ) {
    return undefined;
  }
  const label = typeof response.label === 'string' ? response.label : CANVAS_DEFAULT_LABEL;
  const json = serialize(response.data);
  if (
    json === undefined ||
    content.body !==
      canonicalBody(
        response.agent_user_id,
        response.canvas_event_id,
        response.canvas_revision_event_id,
        label,
        json
      )
  ) {
    return undefined;
  }
  return {
    canvasEventId: response.canvas_event_id,
    label: typeof response.label === 'string' ? response.label : undefined,
    json,
  };
};
