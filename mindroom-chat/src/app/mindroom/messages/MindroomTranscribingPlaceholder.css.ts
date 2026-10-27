import { keyframes, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

const pulse = keyframes({
  '0%, 100%': {
    opacity: 0.45,
    transform: 'scaleY(0.4)',
  },
  '50%': {
    opacity: 1,
    transform: 'scaleY(1)',
  },
});

export const Placeholder = style({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  gap: config.space.S100,
  color: 'inherit',
  font: 'inherit',
  verticalAlign: 'baseline',
});

export const Wave = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  height: '1em',
  color: color.Primary.Main,
});

export const WaveBar = style({
  width: '2px',
  height: '0.8em',
  borderRadius: '999px',
  backgroundColor: 'currentColor',
  transformOrigin: 'center',
  animation: `${pulse} 900ms ease-in-out infinite`,
  selectors: {
    '&:nth-child(2)': {
      animationDelay: '-600ms',
    },
    '&:nth-child(3)': {
      animationDelay: '-300ms',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      opacity: 0.75,
      transform: 'scaleY(0.65)',
    },
  },
});

export const Text = style({
  minWidth: 0,
  fontWeight: 700,
});
