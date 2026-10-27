import { hasMindroomLongTextMetadata } from './longText';

export const shouldUseMindroomLightweightSearchResultBody = (
  content: Record<string, unknown>
): boolean => hasMindroomLongTextMetadata(content);
