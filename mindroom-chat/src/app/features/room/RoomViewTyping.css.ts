import { keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

const SlideUpAnime = keyframes({
  from: {
    transform: `translateY(${config.space.S200})`,
  },
  to: {
    transform: 'translateY(0)',
  },
});

export const RoomViewTyping = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    margin: `0 ${config.space.S400} ${config.space.S200}`,
    padding: `${config.space.S100} ${config.space.S300}`,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    animation: `${SlideUpAnime} 100ms ease-in-out`,
    '@media': {
      '(prefers-reduced-motion: reduce)': { animation: 'none' },
    },
  },
]);
export const TypingText = style({
  flexGrow: 1,
  minWidth: 0,
});
