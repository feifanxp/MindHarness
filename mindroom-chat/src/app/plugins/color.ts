import chroma from 'chroma-js';
import { ThemeKind } from '../hooks/useTheme';

/**
 * Where a power-level tag colour has to land to be readable and to look like
 * it belongs. These are the same lightness and chroma targets the
 * `--mx-uc-*` user colours in `src/index.css` are generated from, so a
 * moderator's name and a sender's name sit in one family instead of two.
 */
const TARGET: Record<ThemeKind, { lightness: number; maxChroma: number }> = {
  [ThemeKind.Light]: { lightness: 0.52, maxChroma: 0.125 },
  [ThemeKind.Dark]: { lightness: 0.82, maxChroma: 0.115 },
};

/**
 * Pulls chroma in until the colour is inside sRGB. Letting `.hex()` clip
 * instead would silently drag hue and lightness along with it, which is the
 * opposite of what a fixed-lightness ramp is for.
 */
const toDisplayable = (lightness: number, targetChroma: number, hue: number): string => {
  for (let c = targetChroma; c > 0; c -= 0.005) {
    const candidate = chroma.oklch(lightness, c, hue);
    if (!candidate.clipped()) return candidate.hex();
  }
  return chroma.oklch(lightness, 0, hue).hex();
};

/**
 * Normalises an arbitrary tag colour onto the theme's ramp.
 *
 * The previous version only clamped LAB lightness, which left saturation
 * untouched: the default moderator green `#1fd81f` stayed neon in both themes
 * and read as a different design language from everything around it. Hue is
 * still the caller's, since that is what distinguishes one tag from another;
 * lightness and chroma are the theme's.
 */
export const accessibleColor = (themeKind: ThemeKind, color: string): string => {
  if (!chroma.valid(color)) return color;

  const [, colorChroma, hue] = chroma(color).oklch();
  const { lightness, maxChroma } = TARGET[themeKind];

  // Greys have no meaningful hue; oklch() reports NaN for them.
  const safeHue = Number.isNaN(hue) ? 0 : hue;

  return toDisplayable(lightness, Math.min(colorChroma, maxChroma), safeHue);
};
