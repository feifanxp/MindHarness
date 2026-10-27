const AI_RUN_METADATA_KEY = 'io.mindroom.ai_run';

type MindroomAiRunModel = {
  config?: unknown;
  display_name?: unknown;
  id?: unknown;
  provider?: unknown;
};

type MindroomAiRunUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_write_tokens?: unknown;
  time_to_first_token?: unknown;
};

type MindroomAiRunContext = {
  input_tokens?: unknown;
  window_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_write_input_tokens?: unknown;
  uncached_input_tokens?: unknown;
};

type MindroomAiRunTools = {
  count?: unknown;
};

type MindroomAiRunMetadata = {
  version?: unknown;
  status?: unknown;
  run_id?: unknown;
  session_id?: unknown;
  model?: unknown;
  usage?: unknown;
  context?: unknown;
  tools?: unknown;
};

export type MindroomAiRunInfo = {
  status?: string;
  runId?: string;
  sessionId?: string;
  modelConfig?: string;
  /** Trimmed, nonempty display name from message metadata. */
  modelDisplayName?: string;
  modelId?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  timeToFirstToken?: number;
  contextInputTokens?: number;
  contextWindowTokens?: number;
  contextCacheReadInputTokens?: number;
  contextCacheWriteInputTokens?: number;
  contextUncachedInputTokens?: number;
  toolCount?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getMindroomAiRunMetadataFromCandidate = (
  content: Record<string, unknown>
): MindroomAiRunMetadata | undefined => {
  const metadata = content[AI_RUN_METADATA_KEY];
  if (!isRecord(metadata)) return undefined;
  if (metadata.version !== 1) return undefined;
  return metadata as MindroomAiRunMetadata;
};

const getMindroomAiRunMetadata = (
  content: Record<string, unknown>
): MindroomAiRunMetadata | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  if (newContent) {
    const fromNewContent = getMindroomAiRunMetadataFromCandidate(newContent);
    if (fromNewContent) return fromNewContent;
  }

  return getMindroomAiRunMetadataFromCandidate(content);
};

export const getMindroomAiRunInfo = (
  content: Record<string, unknown>
): MindroomAiRunInfo | undefined => {
  const metadata = getMindroomAiRunMetadata(content);
  if (!metadata) return undefined;

  const model = isRecord(metadata.model) ? (metadata.model as MindroomAiRunModel) : undefined;
  const usage = isRecord(metadata.usage) ? (metadata.usage as MindroomAiRunUsage) : undefined;
  const context = isRecord(metadata.context)
    ? (metadata.context as MindroomAiRunContext)
    : undefined;
  const tools = isRecord(metadata.tools) ? (metadata.tools as MindroomAiRunTools) : undefined;

  const info: MindroomAiRunInfo = {
    status: asString(metadata.status),
    runId: asString(metadata.run_id),
    sessionId: asString(metadata.session_id),
    modelConfig: asString(model?.config),
    modelDisplayName: asString(model?.display_name)?.trim() || undefined,
    modelId: asString(model?.id),
    modelProvider: asString(model?.provider),
    inputTokens: asFiniteNumber(usage?.input_tokens),
    outputTokens: asFiniteNumber(usage?.output_tokens),
    totalTokens: asFiniteNumber(usage?.total_tokens),
    cacheReadTokens: asFiniteNumber(usage?.cache_read_tokens),
    cacheWriteTokens: asFiniteNumber(usage?.cache_write_tokens),
    timeToFirstToken: asFiniteNumber(usage?.time_to_first_token),
    contextInputTokens: asFiniteNumber(context?.input_tokens),
    contextWindowTokens: asFiniteNumber(context?.window_tokens),
    contextCacheReadInputTokens: asFiniteNumber(context?.cache_read_input_tokens),
    contextCacheWriteInputTokens: asFiniteNumber(context?.cache_write_input_tokens),
    contextUncachedInputTokens: asFiniteNumber(context?.uncached_input_tokens),
    toolCount: asFiniteNumber(tools?.count),
  };

  const hasAnyInfo = Object.values(info).some((value) => value !== undefined);
  return hasAnyInfo ? info : undefined;
};

const TERMINAL_AI_RUN_STATUSES = new Set(['completed', 'cached', 'error', 'cancelled']);

export const STREAM_STATUS_KEY = 'io.mindroom.stream_status';
// 'pending' counts as active so callers driving spinners (e.g. thread streaming
// state) treat a not-yet-started run as still in flight.
export const ACTIVE_STREAM_STATUSES = new Set(['active', 'pending', 'running', 'streaming']);
export const TERMINAL_STREAM_STATUSES = new Set([
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'stopped',
  'cancelled',
  'interrupted',
]);

export const getStreamStatusFromContent = (
  content: Record<string, unknown>
): string | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  const raw = newContent?.[STREAM_STATUS_KEY] ?? content[STREAM_STATUS_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : undefined;
};

/**
 * True only when the content itself proves the stream reached a terminal
 * state. Absent or unrecognized metadata returns false — callers must not
 * treat "not terminal" as "still streaming".
 */
export const hasTerminalMindroomStreamMetadata = (content: Record<string, unknown>): boolean => {
  const metadata = getMindroomAiRunMetadata(content);
  const aiRunStatus =
    typeof metadata?.status === 'string' ? metadata.status.toLowerCase() : undefined;
  if (aiRunStatus && TERMINAL_AI_RUN_STATUSES.has(aiRunStatus)) return true;

  const streamStatus = getStreamStatusFromContent(content);
  return !!streamStatus && TERMINAL_STREAM_STATUSES.has(streamStatus);
};

export const isMindroomAiRunStreaming = (content: Record<string, unknown>): boolean => {
  // Check io.mindroom.ai_run metadata (present on final edits)
  const metadata = getMindroomAiRunMetadata(content);
  if (metadata) {
    const status = typeof metadata.status === 'string' ? metadata.status : undefined;
    return !status || !TERMINAL_AI_RUN_STATUSES.has(status);
  }

  // Check io.mindroom.stream_status (present on intermediate streaming edits)
  const streamStatus = getStreamStatusFromContent(content);
  if (streamStatus) {
    return ACTIVE_STREAM_STATUSES.has(streamStatus) && !TERMINAL_STREAM_STATUSES.has(streamStatus);
  }

  return false;
};

export { AI_RUN_METADATA_KEY };
