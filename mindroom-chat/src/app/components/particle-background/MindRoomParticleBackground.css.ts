import { style } from '@vanilla-extract/css';

import { particleBackgroundGradientVar } from './particleBackgroundTheme.css';

export const ParticleBackground = style({
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  background: particleBackgroundGradientVar,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      opacity: 0.75,
    },
  },
});

export const ParticleBackgroundFixed = style({
  position: 'fixed',
});

export const ParticleCanvas = style({
  width: '100%',
  height: '100%',
  opacity: 1,
  pointerEvents: 'auto',
  touchAction: 'none',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      display: 'none !important',
    },
  },
});
