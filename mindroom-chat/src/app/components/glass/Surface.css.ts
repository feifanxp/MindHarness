import { style } from '@vanilla-extract/css';

export const inheritSurface = style({
  selectors: {
    '&&': {
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      boxShadow: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
  },
});
