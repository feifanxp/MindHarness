export type ArgumentValue =
  | { kind: 'text'; text: string }
  | { kind: 'scalar'; text: string }
  | { kind: 'nested'; fields: ArgumentField[] }
  | { kind: 'json'; text: string };

export type ArgumentField = { key: string; value: ArgumentValue };

/** Labeled fields for an object of arguments, or the raw text when there is no object to label. */
export type ArgumentFields = { fields: ArgumentField[] } | { raw: string };

const INLINE_LIST_MAX_ITEMS = 5;
const INLINE_LIST_MAX_CHARS = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2) ?? '';

// Tool arguments often carry JSON encoded as a string; only complete objects or arrays count.
const parseJsonContainer = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const toListValue = (items: unknown[]): ArgumentValue => {
  if (items.length === 0) return { kind: 'scalar', text: '[]' };
  const primitives = items.every(
    (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item)
  );
  const inline = items.map(String).join(', ');
  return primitives &&
    items.length <= INLINE_LIST_MAX_ITEMS &&
    inline.length <= INLINE_LIST_MAX_CHARS &&
    !inline.includes('\n')
    ? { kind: 'scalar', text: inline }
    : { kind: 'json', text: formatJson(items) };
};

function toValue(value: unknown, nested: boolean): ArgumentValue {
  if (typeof value === 'string') {
    const container = parseJsonContainer(value);
    return container === undefined ? { kind: 'text', text: value } : toValue(container, nested);
  }
  if (Array.isArray(value)) return toListValue(value);
  if (isRecord(value)) {
    return nested
      ? { kind: 'json', text: formatJson(value) }
      : { kind: 'nested', fields: toFields(value, true) };
  }
  return { kind: 'scalar', text: value === undefined ? '' : String(value) };
}

function toFields(record: Record<string, unknown>, nested: boolean): ArgumentField[] {
  return Object.entries(record).map(([key, value]) => ({ key, value: toValue(value, nested) }));
}

export const toArgumentFields = (value: unknown): ArgumentFields => {
  const parsed = typeof value === 'string' ? parseJsonContainer(value) : value;
  if (isRecord(parsed)) return { fields: toFields(parsed, false) };
  if (typeof value === 'string') return { raw: value };
  return { raw: value === undefined ? '' : formatJson(value) };
};

const EMPTY_TEXT = new Set(['', '[]', '{}', 'null']);

const renderedLength = (value: ArgumentValue): number =>
  value.kind === 'nested'
    ? value.fields.reduce(
        (total, field) => total + field.key.length + renderedLength(field.value),
        0
      )
    : value.text.length;

const isEmptyValue = (value: ArgumentValue): boolean =>
  value.kind === 'nested' ? value.fields.length === 0 : EMPTY_TEXT.has(value.text.trim());

// Who or what a call acts on reads first; these keys lead in the order listed.
const KEY_ORDER = [
  'to',
  'cc',
  'bcc',
  'recipient',
  'recipients',
  'room',
  'channel',
  'chat',
  'user',
  'subject',
  'title',
  'name',
  'url',
  'method',
  'path',
  'file',
  'command',
  'args',
  'query',
];
const LONG_VALUE_CHARS = 80;

const isLongValue = (value: ArgumentValue): boolean =>
  renderedLength(value) > LONG_VALUE_CHARS ||
  (value.kind !== 'nested' && value.text.includes('\n'));

/**
 * One order for the preview and the full list: Matrix stores event JSON with sorted keys, so
 * event order puts `body` before `to`. Known target keys lead, long values go last, and
 * everything else keeps event order.
 */
export const orderArgumentFields = (fields: ArgumentField[]): ArgumentField[] =>
  fields
    .map((field, index) => {
      const known = KEY_ORDER.indexOf(field.key.toLowerCase());
      return {
        field,
        index,
        long: isLongValue(field.value) ? 1 : 0,
        rank: known === -1 ? KEY_ORDER.length : known,
      };
    })
    .sort((a, b) => a.long - b.long || a.rank - b.rank || a.index - b.index)
    .map(({ field }) => field);

/** The first filled-in fields in display order, for a glance before expanding. */
export const pickPreviewFields = (fields: ArgumentField[], limit: number): ArgumentField[] => {
  const ordered = orderArgumentFields(fields);
  const filled = ordered.filter((field) => !isEmptyValue(field.value));
  return (filled.length > 0 ? filled : ordered).slice(0, limit);
};

const valueText = (value: ArgumentValue): string =>
  value.kind === 'nested'
    ? value.fields.map((field) => `${field.key}: ${valueText(field.value)}`).join(', ')
    : value.text;

/**
 * One set of fields for several calls of the same tool: values they share show once,
 * values that differ are joined, so a group reads like the mockup's "#a · #b".
 */
export const mergeArgumentFields = (values: unknown): ArgumentFields => {
  const parsed = (Array.isArray(values) ? values : [values]).map(toArgumentFields);
  const [first] = parsed;
  if (!first) return { raw: '' };
  const labeled = parsed.filter((item): item is { fields: ArgumentField[] } => 'fields' in item);
  if (parsed.length === 1 || labeled.length !== parsed.length) return first;
  // Every call's keys, so a field only a later call carries is shown too.
  const keys = new Set(labeled.flatMap((item) => item.fields.map((field) => field.key)));
  return {
    fields: [...keys].map((key) => {
      const matches = labeled.map((item) => item.fields.find((field) => field.key === key));
      const texts = matches.map((match) => (match ? valueText(match.value) : ''));
      const distinct = [...new Set(texts)];
      return distinct.length === 1 && matches[0]
        ? matches[0]
        : { key, value: { kind: 'text', text: distinct.filter(Boolean).join(' · ') } };
    }),
  };
};

/** The most telling argument as "key value" on one line, for a summary next to a decision. */
export const summarizeArguments = (value: unknown): string | undefined => {
  const parsed = toArgumentFields(value);
  if (!('fields' in parsed)) return undefined;
  const [field] = pickPreviewFields(parsed.fields, 1);
  if (!field) return undefined;
  const text = field.value.kind === 'nested' ? '{…}' : field.value.text;
  return `${field.key} ${text.replace(/\s+/g, ' ').trim()}`;
};

// MindRoom writes tool-call previews as `key=value, key=value`; values are text or compact JSON.
const TOOL_ARGUMENT_KEY = /(?:^|, )([A-Za-z_][\w.-]*)=/g;

/** Labeled fields for a tool-call `args_preview`, accepting JSON previews from older senders. */
export const toToolArgumentFields = (preview: unknown): ArgumentFields => {
  if (typeof preview !== 'string' || parseJsonContainer(preview) !== undefined) {
    return toArgumentFields(preview);
  }
  const matches = [...preview.matchAll(TOOL_ARGUMENT_KEY)];
  if (matches.length === 0 || matches[0].index !== 0) return { raw: preview };
  return {
    fields: matches.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end =
        index + 1 < matches.length ? matches[index + 1].index ?? preview.length : preview.length;
      return { key: match[1], value: toValue(preview.slice(start, end), false) };
    }),
  };
};
