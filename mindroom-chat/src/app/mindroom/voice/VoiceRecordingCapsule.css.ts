import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassOutline, glassShadow, glassSurface } from '../../styles/Glass.css';

export const Capsule = style([
  DefaultReset,
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassOutline,
  {
    display: 'grid',
    gridTemplateColumns: `${toRem(36)} minmax(${toRem(96)}, 1fr) auto ${toRem(36)} ${toRem(36)}`,
    alignItems: 'center',
    gap: config.space.S200,
    width: '100%',
    minHeight: toRem(48),
    padding: `${config.space.S100} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    boxShadow: glassShadow,
  },
]);

export const Timer = style({
  minWidth: toRem(36),
  color: color.SurfaceVariant.OnContainer,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'end',
  whiteSpace: 'nowrap',
});

export const HiddenStatus = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
