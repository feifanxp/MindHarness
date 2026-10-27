export type MindroomToolTraceEvent = {
  type?: unknown;
  tool_name?: unknown;
  args_preview?: unknown;
  result_preview?: unknown;
  truncated?: unknown;
};

export type MindroomToolMetadataStatus = 'loading' | 'unavailable';

type MindroomToolTraceContent = {
  version?: unknown;
  events?: unknown;
};

const getMindroomToolTrace = (
  content: Record<string, unknown>
): MindroomToolTraceContent | undefined => {
  const trace = content['io.mindroom.tool_trace'];
  if (!trace || typeof trace !== 'object') return undefined;
  return trace as MindroomToolTraceContent;
};

export const isMindroomToolTraceV2 = (content: Record<string, unknown>): boolean =>
  getMindroomToolTrace(content)?.version === 2;

export const getMindroomToolTraceEvents = (
  content: Record<string, unknown>
): MindroomToolTraceEvent[] | undefined => {
  const eventsRaw = getMindroomToolTrace(content)?.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) return undefined;

  const events = eventsRaw.filter(
    (event): event is MindroomToolTraceEvent => !!event && typeof event === 'object'
  );

  return events.length > 0 ? events : undefined;
};

export const getMindroomToolTraceEventByIndex = (
  content: Record<string, unknown>,
  oneBasedIndex: number
): MindroomToolTraceEvent | undefined => {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) return undefined;
  const events = getMindroomToolTraceEvents(content);
  return events?.[oneBasedIndex - 1];
};
