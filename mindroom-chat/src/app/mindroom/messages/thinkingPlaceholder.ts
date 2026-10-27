export const MINDROOM_THINKING_PLACEHOLDER_BODY = 'Thinking...';

export const DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES = [
  'Making progress',
  'Almost there',
  'Boosting the GPUs',
  'Checking the thread',
  'Composing the reply',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getMindroomThinkingPlaceholderBody = (
  content: Record<string, unknown>
): string | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const body = newContent?.body ?? content.body;
  return typeof body === 'string' ? body : undefined;
};

export const isMindroomThinkingPlaceholderBody = (content: Record<string, unknown>): boolean =>
  getMindroomThinkingPlaceholderBody(content) === MINDROOM_THINKING_PLACEHOLDER_BODY;

export const resolveMindroomThinkingPlaceholderMessages = (
  configuredMessages: unknown
): readonly string[] => {
  if (!Array.isArray(configuredMessages)) return DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES;

  const messages = configuredMessages
    .filter((message): message is string => typeof message === 'string')
    .map((message) => message.trim())
    .filter((message) => message.length > 0);

  return messages.length > 0 ? messages : DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES;
};
