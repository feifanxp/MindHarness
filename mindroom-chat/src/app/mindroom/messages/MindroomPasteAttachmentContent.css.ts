import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../styles/Glass.css';

export const Card = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: config.space.S100,
    maxWidth: 'min(100%, 28rem)',
    padding: config.space.S200,
    color: color.SurfaceVariant.OnContainer,
    borderRadius: config.radii.R300,
    boxSizing: 'border-box',
  },
]);

export const Outlined = glassOutline;

export const Header = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: config.space.S200,
  minWidth: 0,
});

export const Title = style({
  fontWeight: config.fontWeight.W600,
});

export const Meta = style({
  opacity: 0.72,
});

export const FileName = style({
  flex: '1 1 auto',
  minWidth: toRem(120),
  maxWidth: toRem(220),
  opacity: 0.72,
});

export const Details = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

globalStyle(`${Actions} > button`, {
  width: 'auto',
});
