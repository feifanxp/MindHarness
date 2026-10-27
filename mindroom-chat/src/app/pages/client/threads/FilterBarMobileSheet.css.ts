import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const SheetBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S400,
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--sp-extra, 0px))',
});

export const SheetContainer = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  minHeight: '100svh',
  height: '100dvh',
  width: '100vw',
});
