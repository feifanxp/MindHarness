import { keyframes, style } from '@vanilla-extract/css';
import { toRem } from 'folds';

const pulse = keyframes({
  '0%, 100%': { opacity: '0.3' },
  '50%': { opacity: '1' },
});

export const Container = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  marginInlineStart: toRem(4),
  verticalAlign: 'baseline',
});

const dotBase = style({
  display: 'inline-block',
  width: toRem(4),
  height: toRem(4),
  borderRadius: '50%',
  backgroundColor: 'currentColor',
  animation: `${pulse} 1.4s ease-in-out infinite`,
  animationFillMode: 'both',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: '0.6',
    },
  },
});

export const Dot0 = style([dotBase, { animationDelay: '0s' }]);
export const Dot1 = style([dotBase, { animationDelay: '0.2s' }]);
export const Dot2 = style([dotBase, { animationDelay: '0.4s' }]);
