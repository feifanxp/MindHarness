import { style } from '@vanilla-extract/css';
import { color } from 'folds';

// The scrollbar is a direct child of this scroller, but is positioned against
// its outer wrapper so it stays fixed while content scrolls behind the controls.
export const Viewport = style({
  position: 'static',
  scrollbarWidth: 'none',
  selectors: { '&::-webkit-scrollbar': { display: 'none' } },
});

export const Track = style({
  position: 'absolute',
  insetInlineEnd: 0,
  width: 12,
  minHeight: 0,
  touchAction: 'none',
  userSelect: 'none',
  cursor: 'default',
  opacity: 0,
  selectors: {
    '&[data-overflow="false"]': { visibility: 'hidden' },
    '&[data-active="true"], &:hover, &:focus-visible': { opacity: 1 },
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
  },
});

export const Thumb = style({
  position: 'absolute',
  top: 0,
  insetInline: 4,
  borderRadius: 4,
  backgroundColor: `var(--mr-scrollbar-thumb-color, ${color.Surface.OnContainer})`,
  '@media': { '(forced-colors: active)': { backgroundColor: 'ButtonText' } },
});
