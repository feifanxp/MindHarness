import { style } from '@vanilla-extract/css';

export const PersistentParticleBackground = style({
  position: 'fixed',
  inset: 0,
  zIndex: 0,
  isolation: 'isolate',
  pointerEvents: 'none',
});
