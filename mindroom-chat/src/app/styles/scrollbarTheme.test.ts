import { readFileSync } from 'node:fs';
import chroma from 'chroma-js';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const colorsSource = readFileSync(new URL('../../colors.css.ts', import.meta.url), 'utf8');
const foldsCss = readFileSync(
  new URL('../../../node_modules/folds/dist/style.css', import.meta.url),
  'utf8'
);

describe('scrollbar theme', () => {
  it('keeps the dark-theme thumb visible on every dark track', () => {
    const thumbValue = indexCss.match(
      /\.dark-theme,\s*\.midnight-theme,\s*\.butter-theme\s*\{[^}]*--mr-scrollbar-thumb-color:\s*(#[\da-f]{8})/i
    )?.[1];
    if (!thumbValue) throw new Error('Dark scrollbar thumb token is missing.');

    const darkPalette = colorsSource.slice(colorsSource.indexOf('const darkAccents'));
    const darkTracks = [...darkPalette.matchAll(/ContainerHover:\s*'(#[\da-f]{6})'/gi)].map(
      ([, track]) => track
    );
    if (darkTracks.length === 0) throw new Error('Dark scrollbar tracks are missing.');

    const thumb = chroma(thumbValue);
    darkTracks.forEach((track) => {
      const renderedThumb = chroma.mix(track, thumb.alpha(1), thumb.alpha(), 'rgb');
      expect(chroma.contrast(renderedThumb, track), track).toBeGreaterThanOrEqual(3);
    });

    const scrollFallback = 'var(--mr-scrollbar-thumb-color, var(--_4yxtfd1))';
    expect(foldsCss.split(scrollFallback)).toHaveLength(5);
    expect(foldsCss).toContain(`scrollbar-color: ${scrollFallback} var(--_4yxtfd0)`);

    const textAreaFallback = 'var(--mr-scrollbar-thumb-color, var(--ay20pp3))';
    expect(foldsCss.split(textAreaFallback)).toHaveLength(3);
    expect(foldsCss).toContain(`scrollbar-color: ${textAreaFallback} transparent`);
  });
});
