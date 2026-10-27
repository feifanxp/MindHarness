/**
 * Deterministic HSL color from tag name.
 * Ported from CINNY-035a CompactThreadCard pattern (commit 2056e7db).
 *
 * Produces a pastel background color suitable for dark text.
 */

const hashString = (str: string): number => {
  let hash = 0;
  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + char;
    // eslint-disable-next-line no-bitwise
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

/**
 * Get a deterministic pastel HSL color string for a tag name.
 * Uses hsl(hash, 65%, 82%) for consistent pastel backgrounds.
 */
export const tagColor = (name: string): string => {
  const hue = hashString(name) % 360;
  return `hsl(${hue}, 65%, 82%)`;
};

/** Dark text color for contrast on pastel backgrounds. */
export const TAG_TEXT_COLOR = '#1a1a1a';
