import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

export const PinMenu = style({
  display: 'flex',
  maxWidth: toRem(548),
  width: '100vw',
  maxHeight: '90vh',
});

export const PinMenuHeader = style({
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
});

export const PinMenuContent = style({
  paddingInlineStart: config.space.S200,
});
