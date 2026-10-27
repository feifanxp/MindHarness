import { isMindroomMessageMetadataKey } from './metadata';

// Says that this event's own file holds the message, so it is never inherited from another edit.
const LONG_TEXT_KEY = 'io.mindroom.long_text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const copyMindroomResolvedEditMetadata = (
  resolvedContent: Record<string, unknown>,
  sources: ReadonlyArray<Record<string, unknown> | undefined>
): void => {
  sources.forEach((source) => {
    if (!source) return;

    const newContent = isRecord(source['m.new_content']) ? source['m.new_content'] : undefined;
    [newContent, source].forEach((metadataSource) => {
      if (!metadataSource) return;

      Object.entries(metadataSource).forEach(([key, value]) => {
        if (resolvedContent[key] !== undefined) return;
        if (!isMindroomMessageMetadataKey(key) || key === LONG_TEXT_KEY) return;
        resolvedContent[key] = value;
      });
    });
  });
};
