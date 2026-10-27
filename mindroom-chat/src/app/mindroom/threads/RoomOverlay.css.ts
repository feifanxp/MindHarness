import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';
import { Viewport } from '../../components/inset-scrollbar/InsetScrollbar.css';
import { shortViewport } from './shortViewport';

// Measured once per layout change, shared by scroll padding and floating controls.
export const headerInset = 'var(--room-header-height, 0px)';
export const footerInset = 'var(--room-footer-height, 0px)';
export const overviewInset = 'var(--room-overview-height, 0px)';
export const topInset = `calc(${headerInset} + ${overviewInset})`;
export const controlsTopInset = `calc(${topInset} + var(--room-thread-header-height, 0px))`;

export const Header = style({ position: 'absolute', inset: '0 0 auto', zIndex: 6 });
// The thread banner already offers the way back, so on short screens it is the
// only bar; the room header returns once the thread closes.
export const HeaderInThread = style({ '@media': { [shortViewport]: { display: 'none' } } });
// Read receipts give way to messages on short screens. The composer pads
// itself for the safe area, so the footer only keeps a small gap below it.
export const Footer = style({
  position: 'absolute',
  inset: 'auto 0 0',
  zIndex: 4,
  pointerEvents: 'none',
  '@media': { [shortViewport]: { paddingBottom: config.space.S200 } },
});
globalStyle(`${Footer} > *`, { pointerEvents: 'auto' });
export const Following = style({ '@media': { [shortViewport]: { display: 'none' } } });
export const Overview = style({
  position: 'absolute',
  insetInline: 0,
  top: headerInset,
  zIndex: 5,
  display: 'flow-root',
});
export const Scroll = style([
  Viewport,
  {
    scrollPaddingTop: topInset,
    scrollPaddingBottom: footerInset,
  },
]);
export const Scrollbar = style({ top: controlsTopInset, bottom: footerInset, zIndex: 3 });
