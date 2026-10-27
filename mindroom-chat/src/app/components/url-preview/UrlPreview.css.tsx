import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../styles/Glass.css';

export const UrlPreview = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassOutline,
  {
    width: toRem(400),
    minHeight: toRem(102),
    color: color.SurfaceVariant.OnContainer,
    borderRadius: config.radii.R300,
    overflow: 'hidden',
  },
]);

export const UrlPreviewImg = style([
  DefaultReset,
  {
    width: toRem(100),
    height: toRem(100),
    objectFit: 'cover',
    objectPosition: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    cursor: 'pointer',

    ':hover': {
      filter: 'brightness(0.8)',
    },
  },
]);

export const UrlPreviewContent = style([
  DefaultReset,
  {
    padding: config.space.S200,
  },
]);

export const UrlPreviewDescription = style([
  DefaultReset,
  {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
]);
