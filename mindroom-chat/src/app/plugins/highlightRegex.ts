import { sanitizeForRegex } from '../utils/regex';

export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  const pattern = highlights
    .map((highlight) => highlight.trim())
    .filter((highlight) => highlight.length > 0)
    .map(sanitizeForRegex)
    .join('|');

  if (!pattern) return undefined;

  return new RegExp(pattern, 'gi');
};
