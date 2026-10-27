import { style } from '@vanilla-extract/css';
import { DefaultReset, config } from 'folds';

export const EventReaders = style([
  DefaultReset,
  {
    height: '100%',
  },
]);

export const Header = style({
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S300,

  flexShrink: 0,
});

export const Content = style({
  paddingInlineStart: config.space.S200,
  paddingBottom: config.space.S400,
});
