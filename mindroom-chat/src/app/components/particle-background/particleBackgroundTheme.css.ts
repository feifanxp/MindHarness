import { createVar, globalStyle } from '@vanilla-extract/css';
import { DARK_PARTICLE_THEME, LIGHT_PARTICLE_THEME } from './particleBackgroundTheme';

export const particleBackgroundColorVar = createVar();
export const particleBackgroundGradientVar = createVar();
export const particleCardBackgroundVar = createVar();
export const particleCardTextVar = createVar();
export const particleCardHighlightVar = createVar();
export const particleCardBorderVar = createVar();

// The theme id class is set on <html> by the index.html bootstrap script before
// first paint and kept in sync by applyThemeToDom(), so these variables are
// correct from the very first frame of the splash screen.
globalStyle(':root', {
  vars: {
    [particleBackgroundColorVar]: DARK_PARTICLE_THEME.backgroundColor,
    [particleBackgroundGradientVar]: DARK_PARTICLE_THEME.backgroundRadialGradient,
    [particleCardBackgroundVar]: DARK_PARTICLE_THEME.cardBackground,
    [particleCardTextVar]: DARK_PARTICLE_THEME.cardText,
    [particleCardHighlightVar]: DARK_PARTICLE_THEME.cardHighlight,
    [particleCardBorderVar]: DARK_PARTICLE_THEME.cardBorder,
  },
});

globalStyle(':root.light-theme, :root.silver-theme', {
  vars: {
    [particleBackgroundColorVar]: LIGHT_PARTICLE_THEME.backgroundColor,
    [particleBackgroundGradientVar]: LIGHT_PARTICLE_THEME.backgroundRadialGradient,
    [particleCardBackgroundVar]: LIGHT_PARTICLE_THEME.cardBackground,
    [particleCardTextVar]: LIGHT_PARTICLE_THEME.cardText,
    [particleCardHighlightVar]: LIGHT_PARTICLE_THEME.cardHighlight,
    [particleCardBorderVar]: LIGHT_PARTICLE_THEME.cardBorder,
  },
});
