import { globalStyle, style } from '@vanilla-extract/css';
import { color } from 'folds';

export const Panel = style({
  vars: { '--mr-panel-handle-inset': '8px' },
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  minHeight: 0,
  maxWidth: '100%',
  '@media': {
    '(pointer: coarse)': { vars: { '--mr-panel-handle-inset': '12px' } },
  },
});

globalStyle(`${Panel} > :first-child`, { width: '100%', minWidth: 0 });
globalStyle(`${Panel}[data-collapse-preview='true'] > :first-child`, {
  visibility: 'hidden',
  overflow: 'hidden',
});

export const Handle = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetInlineEnd: 'calc(-1 * var(--mr-panel-handle-inset))',
  width: 'calc(2 * var(--mr-panel-handle-inset))',
  zIndex: 1,
  cursor: 'col-resize',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
  selectors: {
    [`${Panel}[data-side='end'] &`]: {
      insetInlineEnd: 'auto',
      insetInlineStart: 'calc(-1 * var(--mr-panel-handle-inset))',
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 'calc(var(--mr-panel-handle-inset) - 1px)',
      width: 2,
      backgroundColor: color.Background.ContainerLine,
    },
    '&:hover::after, &:focus-visible::after, &:active::after': {
      backgroundColor: color.Primary.Main,
    },
  },
});

// Keep the scrollbar's hit area clear of the splitter; full-width panels have no handle.
globalStyle(`${Panel}[data-side='start']:has(> ${Handle})`, {
  vars: { '--mr-scrollbar-inset-end': 'var(--mr-panel-handle-inset)' },
});
