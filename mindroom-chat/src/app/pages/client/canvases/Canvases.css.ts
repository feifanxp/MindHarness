import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Note = style({
  display: 'block',
  paddingBottom: config.space.S300,
});

export const Empty = style({
  display: 'block',
  padding: `${config.space.S700} 0`,
  textAlign: 'center',
});

export const TableScroll = style({
  maxWidth: '100%',
  overflowX: 'auto',
});

export const Table = style({
  width: '100%',
  borderCollapse: 'collapse',
});

globalStyle(`${Table} th, ${Table} td`, {
  padding: `${config.space.S200} ${config.space.S300}`,
  textAlign: 'start',
  verticalAlign: 'middle',
  borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

globalStyle(`${Table} th`, {
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

// The dates stay on one line; titles and room names wrap.
globalStyle(`${Table} td:nth-child(n + 6)`, {
  whiteSpace: 'nowrap',
});

export const Link = style({
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  maxWidth: toRem(360),
  selectors: {
    '&:hover, &:focus-visible': {
      textDecoration: 'underline',
    },
  },
});
