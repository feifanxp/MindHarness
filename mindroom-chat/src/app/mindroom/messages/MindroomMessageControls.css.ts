import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const AiRunInfoButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: toRem(16),
    height: toRem(16),
    border: 0,
    borderRadius: toRem(999),
    padding: 0,
    color: 'inherit',
    opacity: 0.75,
    cursor: 'pointer',
    selectors: {
      '&:hover': {
        opacity: 1,
      },
      '&:focus-visible': {
        opacity: 1,
        outline: `${toRem(2)} solid currentColor`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

export const MenuItemText = style({
  flexGrow: 1,
});

export const AiRunContextBar = style({
  display: 'flex',
  width: '100%',
  height: toRem(10),
  margin: `${config.space.S100} 0`,
  borderRadius: toRem(999),
  overflow: 'hidden',
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const AiRunContextBarSegment = style({
  height: '100%',
  cursor: 'help',
  selectors: {
    '&:focus-visible': {
      outline: `${toRem(2)} solid ${color.Primary.Main}`,
      outlineOffset: toRem(-2),
    },
  },
});

export const AiRunContextBarSegmentCacheRead = style({
  backgroundColor: color.Success.Main,
});

export const AiRunContextBarSegmentNewInput = style({
  backgroundColor: color.Primary.Main,
});

export const AiRunContextBarSegmentReserve = style({
  backgroundColor: color.SurfaceVariant.ContainerLine,
});
