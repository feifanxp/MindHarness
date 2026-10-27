import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

export const Card = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    alignSelf: 'flex-start',
    width: 'fit-content',
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(500)})`,
    padding: config.space.S300,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const MetaDot = style({
  opacity: config.opacity.P400,
});

export const Scope = style({
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Background.Container,
});
