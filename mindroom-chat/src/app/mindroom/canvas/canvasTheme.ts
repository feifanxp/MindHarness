import { color, config } from 'folds';
import type { CanvasColorScheme } from './canvasDocument';

/** Chat's theme as concrete values, exposed to canvases as `--mr-*` CSS variables. */
export type CanvasTheme = Record<
  | 'bg'
  | 'surface'
  | 'surface-raised'
  | 'border'
  | 'text'
  | 'text-muted'
  | 'accent'
  | 'accent-text'
  | 'success'
  | 'warning'
  | 'danger'
  | 'radius'
  | 'font',
  string
>;

// Read lazily: the tokens are CSS variable references that only resolve against the page.
const themeSources = (): Record<Exclude<keyof CanvasTheme, 'font'>, string> => ({
  bg: color.Background.Container,
  surface: color.Surface.Container,
  'surface-raised': color.SurfaceVariant.Container,
  border: color.Surface.ContainerLine,
  text: color.Surface.OnContainer,
  'text-muted': color.SurfaceVariant.OnContainer,
  accent: color.Primary.Main,
  'accent-text': color.Primary.OnMain,
  success: color.Success.Main,
  warning: color.Warning.Main,
  danger: color.Critical.Main,
  radius: config.radii.R400,
});

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const FALLBACK_CANVAS_THEMES: Record<CanvasColorScheme, CanvasTheme> = {
  light: {
    bg: '#f5f6f8',
    surface: '#ffffff',
    'surface-raised': '#eef0f4',
    border: '#d9dde4',
    text: '#1b1f24',
    'text-muted': '#5b6573',
    accent: '#3f6bdb',
    'accent-text': '#ffffff',
    success: '#1f8a4c',
    warning: '#b26a00',
    danger: '#c62828',
    radius: '12px',
    font: SYSTEM_FONT,
  },
  dark: {
    bg: '#14161a',
    surface: '#1c1f25',
    'surface-raised': '#252932',
    border: '#343a46',
    text: '#e8eaee',
    'text-muted': '#9aa3b2',
    accent: '#7c9cff',
    'accent-text': '#0b0d12',
    success: '#4cc38a',
    warning: '#f0b84a',
    danger: '#ff6b6b',
    radius: '12px',
    font: SYSTEM_FONT,
  },
};

// Values end up inside a style element, so only plain CSS values are accepted.
const SAFE_VALUE = /^[\w\s#%(),.'"+/-]+$/;
const safe = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 300 && SAFE_VALUE.test(trimmed) ? trimmed : fallback;
};

const variableName = (reference: string): string | undefined =>
  /^var\((--[\w-]+)/.exec(reference)?.[1];

/** Resolve the live theme from the page's computed styles, falling back per value. */
export const readCanvasTheme = (
  colorScheme: CanvasColorScheme,
  element: Element | null = typeof document === 'undefined' ? null : document.body
): CanvasTheme => {
  const fallback = FALLBACK_CANVAS_THEMES[colorScheme];
  if (!element || typeof getComputedStyle !== 'function') return fallback;
  const style = getComputedStyle(element);
  const theme = { ...fallback };
  const sources = themeSources();
  (Object.keys(sources) as Array<keyof typeof sources>).forEach((key) => {
    const name = variableName(sources[key]);
    theme[key] = safe(name ? style.getPropertyValue(name) : undefined, fallback[key]);
  });
  // Chat's web font cannot load inside the canvas, so system fonts follow it.
  theme.font = safe(
    style.fontFamily ? `${style.fontFamily}, ${SYSTEM_FONT}` : undefined,
    fallback.font
  );
  return theme;
};

export const canvasThemeCss = (theme: CanvasTheme): string =>
  `:root{${(Object.keys(theme) as Array<keyof CanvasTheme>)
    .map((key) => `--mr-${key}:${theme[key]}`)
    .join(';')}}`;
