import { keyframes, style } from '@vanilla-extract/css';
import { color, toRem } from 'folds';

const wobble = keyframes({
  '0%': {
    transform: 'translateX(0) rotateZ(0deg)',
  },
  '20%': {
    transform: `translateX(-${toRem(4)}) rotateZ(-4deg)`,
  },
  '40%': {
    transform: `translateX(${toRem(4)}) rotateZ(4deg)`,
  },
  '60%': {
    transform: `translateX(-${toRem(3)}) rotateZ(-3deg)`,
  },
  '80%': {
    transform: `translateX(${toRem(3)}) rotateZ(3deg)`,
  },
  '100%': {
    transform: 'translateX(0) rotateZ(0deg)',
  },
});

const glowPulse = keyframes({
  '0%': {
    boxShadow: `0 0 0 ${toRem(0)} ${color.Success.ContainerActive}`,
  },
  '100%': {
    boxShadow: `0 0 0 ${toRem(8)} ${color.Success.ContainerActive}`,
  },
});

/**
 * `wobble` translates and rotates, which is exactly the kind of motion
 * `prefers-reduced-motion` exists to suppress. `glowPulse` only grows a box
 * shadow, so it stays: it is what tells you a call is live, and dropping it
 * would remove the signal rather than the motion. That is also why the global
 * reduced-motion rule in index.css clamps transitions but not animations -
 * each animation has to decide for itself which half of it is information.
 */
const reduceMotion = '(prefers-reduced-motion: reduce)';

export const WobbleAnimation = style({
  animation: `${wobble} 2000ms ease-in-out`,
  animationIterationCount: 'infinite',
  '@media': {
    [reduceMotion]: {
      animation: 'none',
    },
  },
});

export const GlowAnimation = style({
  animation: `${glowPulse} 2000ms ease-out`,
  animationIterationCount: 'infinite',
});

export const CallAvatarAnimation = style({
  animation: `${wobble} 2000ms ease-in-out, ${glowPulse} 2000ms ease-out`,
  animationIterationCount: 'infinite',
  '@media': {
    [reduceMotion]: {
      animation: `${glowPulse} 2000ms ease-out`,
      animationIterationCount: 'infinite',
    },
  },
});
