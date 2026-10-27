const MINDROOM_MESSAGE_METADATA_PREFIXES = ['io.mindroom.', 'com.mindroom.'];

export const isMindroomMessageMetadataKey = (key: string): boolean =>
  MINDROOM_MESSAGE_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));

