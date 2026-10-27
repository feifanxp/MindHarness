import { fallbackVar, style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';
import { pageScrollHeaderHeight } from '../page/style.css';

export const ImagePackImage = style([
  DefaultReset,
  {
    width: toRem(36),
    height: toRem(36),
    objectFit: 'contain',
  },
]);

export const DeleteImageShortcode = style([
  DefaultReset,
  {
    color: color.Critical.Main,
    textDecoration: 'line-through',
  },
]);

export const ImagePackImageInputs = style([
  DefaultReset,
  {
    overflow: 'hidden',
    borderRadius: config.radii.R300,
  },
]);

export const UnsavedMenu = style({
  position: 'sticky',
  padding: config.space.S200,
  paddingInlineStart: config.space.S400,
  top: `calc(${fallbackVar(pageScrollHeaderHeight, '0px')} + ${config.space.S400})`,
  insetInlineStart: config.space.S400,
  insetInlineEnd: 0,
  zIndex: 1,
});
