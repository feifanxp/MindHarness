import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Button = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(44),
    minWidth: toRem(44),
    height: toRem(44),
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: config.space.S100,
    },
  },
]);

export const Menu = style({
  minWidth: toRem(168),
  padding: `${config.space.S300} ${config.space.S400}`,
});

export const Track = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: toRem(32),
});

export const TrackLine = style({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: '100%',
  height: toRem(6),
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerLine,
});

export const Thumb = style({
  position: 'relative',
  width: toRem(16),
  height: toRem(16),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Surface.Container}`,
  ':focus-visible': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: config.space.S100,
  },
});
