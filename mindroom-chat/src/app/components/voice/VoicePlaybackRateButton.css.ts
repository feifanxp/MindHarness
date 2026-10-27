import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const Button = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: toRem(44),
    minHeight: toRem(44),
    padding: `${toRem(10)} ${config.space.S100}`,
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: config.space.S100,
    },
  },
]);

export const Label = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '3ch',
  fontWeight: config.fontWeight.W500,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});
