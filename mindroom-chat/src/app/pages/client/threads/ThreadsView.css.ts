import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';

export const View = style([
  DefaultReset,
  {
    minHeight: 0,
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
  },
]);

export const Scroll = style({
  minHeight: 0,
  flex: '1 1 auto',
  overflow: 'auto',
});

export const Count = style({
  padding: `${config.space.S200} ${config.space.S400} 0`,
});

export const List = style({
  position: 'relative',
  padding: `${config.space.S300} ${config.space.S400}`,
});

export const Row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBottom: config.space.S300,
});

export const RowChrome = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
  paddingInline: config.space.S100,
});

export const Chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: toRem(220),
  minWidth: 0,
  padding: `${toRem(2)} ${toRem(8)}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: color.SurfaceVariant.Container,
});

export const Empty = style({
  flex: '1 1 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: config.space.S700,
  textAlign: 'center',
});
