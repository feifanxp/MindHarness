import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

export const Shell = style([
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  {
    selectors: {
      '&&': {
        border: `1px solid color-mix(in srgb, ${color.Surface.OnContainer} 14%, transparent)`,
      },
    },
  },
]);

export const Backdrop = style({
  selectors: {
    '&&': { background: `color-mix(in srgb, ${color.Other.Overlay} 25%, transparent)` },
  },
});

export const Palette = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: 0,
  color: color.Surface.OnContainer,
});

export const Search = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '18px 20px 12px',
  flexShrink: 0,
  color: color.SurfaceVariant.OnContainer,
});

export const Input = style({
  flex: '1 1 auto',
  minWidth: 0,
  padding: '8px 0',
  border: 0,
  outline: 'none',
  background: 'transparent',
  color: color.Surface.OnContainer,
  font: 'inherit',
  fontSize: 16,
  lineHeight: '24px',
  '::placeholder': { color: color.SurfaceVariant.OnContainer },
  ':focus-visible': { boxShadow: `0 1px 0 ${color.Primary.Main}` },
});

export const Close = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  minWidth: 36,
  minHeight: 36,
  padding: 6,
  border: 0,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  cursor: 'pointer',
  ':hover': { background: color.Surface.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 2 },
  '@media': { '(max-width: 480px)': { minWidth: 44, minHeight: 44 } },
});

export const Filters = style({
  display: 'flex',
  gap: 4,
  padding: '0 20px 14px',
  overflowX: 'auto',
  flexShrink: 0,
  borderBottom: `1px solid ${color.Surface.ContainerLine}`,
});

export const Filter = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  flexShrink: 0,
  padding: '7px 10px',
  minHeight: 32,
  border: '1px solid transparent',
  borderRadius: config.radii.R300,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  color: color.SurfaceVariant.OnContainer,
  background: 'transparent',
  cursor: 'pointer',
  ':hover': { background: color.Surface.ContainerHover },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
  selectors: {
    '&[aria-pressed="true"]': {
      color: color.Primary.OnContainer,
      background: `color-mix(in srgb, ${color.Primary.Container} 88%, transparent)`,
      borderColor: color.Primary.ContainerLine,
      boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 10%)',
    },
  },
  '@media': { '(max-width: 480px)': { minHeight: 44 } },
});

export const Prefix = style({
  fontFamily: 'monospace',
  fontSize: 11,
  opacity: 0.8,
  direction: 'ltr',
  unicodeBidi: 'isolate',
});

export const Results = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollbarGutter: 'stable',
  padding: '8px 10px 12px',
  scrollPaddingBlock: 8,
});

export const Group = style({ selectors: { '& + &': { marginTop: 12 } } });

export const GroupTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  color: color.SurfaceVariant.OnContainer,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: '0.04em',
});

export const GroupCount = style({ fontWeight: 400, opacity: 0.8 });

export const Row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 60,
  padding: '10px',
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  outline: 'none',
  selectors: {
    '&[data-selected="true"]': {
      background: `color-mix(in srgb, ${color.Primary.Container} 88%, transparent)`,
      boxShadow: `inset 0 0 0 1px ${color.Primary.ContainerLine}, inset 0 1px 0 rgb(255 255 255 / 10%), 0 2px 8px rgb(0 0 0 / 4%)`,
    },
  },
  ':focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: -2 },
});

export const RowIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 34,
  height: 34,
  borderRadius: config.radii.R300,
  background: `color-mix(in srgb, ${color.SurfaceVariant.Container} 65%, transparent)`,
  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 8%)',
  color: color.SurfaceVariant.OnContainer,
  selectors: {
    [`${Row}[data-selected="true"] &`]: {
      color: color.Primary.OnContainer,
      background: `color-mix(in srgb, ${color.Primary.ContainerHover} 75%, transparent)`,
    },
  },
});

export const RowText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  flex: '1 1 auto',
  minWidth: 0,
});

export const RowTitle = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '20px',
});

export const RowDescription = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: color.SurfaceVariant.OnContainer,
  fontSize: 12,
  lineHeight: '17px',
});

export const RowEnter = style({
  flexShrink: 0,
  visibility: 'hidden',
  color: color.Primary.OnContainer,
  selectors: { [`${Row}[data-selected="true"] &`]: { visibility: 'visible' } },
  '@media': { '(pointer: coarse)': { display: 'none' } },
});

export const Key = style({
  direction: 'ltr',
  unicodeBidi: 'isolate',
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
  minWidth: 20,
  height: 20,
  padding: '0 4px',
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 11,
  lineHeight: 1,
  background: `color-mix(in srgb, ${color.Surface.Container} 50%, transparent)`,
  boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 6%)',
});

export const Footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '8px 16px',
  flexShrink: 0,
  minHeight: 46,
  padding: '10px 20px',
  borderTop: `1px solid ${color.Surface.ContainerLine}`,
  background: `color-mix(in srgb, ${color.Surface.Container} 20%, transparent)`,
  color: color.SurfaceVariant.OnContainer,
  fontSize: 11,
});

export const KeyboardHints = style({
  display: 'flex',
  gap: 14,
  '@media': { '(max-width: 480px), (pointer: coarse)': { display: 'none' } },
});

export const Hint = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });

export const Empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  minHeight: 220,
  padding: '32px 20px',
  textAlign: 'center',
  color: color.SurfaceVariant.OnContainer,
});

export const EmptyTitle = style({
  color: color.Surface.OnContainer,
  fontSize: 14,
  fontWeight: 500,
});
export const EmptyDescription = style({ fontSize: 13, lineHeight: '20px', maxWidth: 280 });
