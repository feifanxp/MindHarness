import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';

export const Container = style({
  display: 'inline-flex',
  alignItems: 'center',
  marginInlineStart: toRem(4),
  verticalAlign: 'text-bottom',
});
