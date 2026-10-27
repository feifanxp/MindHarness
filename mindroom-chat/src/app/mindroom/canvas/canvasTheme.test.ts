// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { canvasThemeCss, FALLBACK_CANVAS_THEMES, readCanvasTheme } from './canvasTheme';

describe('canvas theme', () => {
  it('falls back to a complete palette for the color scheme', () => {
    expect(readCanvasTheme('dark', null)).toEqual(FALLBACK_CANVAS_THEMES.dark);
  });

  it('reads concrete values from the page and refuses anything that could escape a style', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    element.style.fontFamily = 'Inter, sans-serif';
    const theme = readCanvasTheme('light', element);
    expect(theme.font).toBe('Inter, sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif');
    element.style.fontFamily = 'x}</style><script>alert(1)</script>';
    expect(readCanvasTheme('light', element).font).toBe(FALLBACK_CANVAS_THEMES.light.font);
    element.remove();
  });

  it('renders every token as a --mr variable', () => {
    const css = canvasThemeCss(FALLBACK_CANVAS_THEMES.light);
    expect(css).toContain('--mr-bg:#f5f6f8');
    expect(css).toContain('--mr-accent-text:#ffffff');
    expect(css).toContain('--mr-font:system-ui');
  });
});
