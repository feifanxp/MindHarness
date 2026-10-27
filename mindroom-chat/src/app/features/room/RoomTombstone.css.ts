import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const RoomTombstone = style({
  padding: config.space.S200,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
  paddingInlineStart: config.space.S400,
});
