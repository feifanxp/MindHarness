import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Marker = style({
  display: 'flex',
});

export const MarkerTrigger = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  margin: 0,
  padding: `${toRem(1)} ${config.space.S100}`,
  marginInlineStart: `calc(-1 * ${config.space.S100})`,
  border: 'none',
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  // folds' muted text level, which keeps 12px text above WCAG AA contrast.
  opacity: config.opacity.P300,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible, &[aria-expanded="true"]': {
      opacity: 1,
      color: color.Primary.Main,
      background: color.Primary.Container,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(1),
    },
  },
});

export const MarkerDetails = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxWidth: toRem(280),
});
