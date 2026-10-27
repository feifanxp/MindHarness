import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { MarginSpaced } from '../../styles/CustomHtml.css';

export const Container = style([
  MarginSpaced,
  {
    minWidth: 0,
    maxWidth: '100%',
    whiteSpace: 'normal',
  },
]);

const scrollbarThumb = `var(--mr-scrollbar-thumb-color, ${color.Surface.OnContainer})`;

export const ScrollArea = style({
  maxWidth: '100%',
  overflowX: 'auto',
  scrollbarWidth: 'thin',
  scrollbarColor: `${scrollbarThumb} transparent`,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: 2,
    },
    '&::-webkit-scrollbar': {
      height: 6,
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: scrollbarThumb,
      borderRadius: 3,
    },
  },
});

export const Table = style({
  width: 'max-content',
  maxWidth: 'none',
  margin: 0,
  tableLayout: 'auto',
  borderCollapse: 'collapse',
  // In collapsed borders, hidden suppresses the perimeter even with spanning cells.
  borderStyle: 'hidden',
  wordBreak: 'normal',
  overflowWrap: 'normal',
  whiteSpace: 'normal',
});

globalStyle(`${Table} > caption`, {
  // Keep the caption text visible before scrolling a wide table.
  textAlign: 'start',
});

globalStyle(`${Table} > :is(thead, tbody, tfoot) > tr > :is(th, td), ${Table} > tr > :is(th, td)`, {
  padding: `${config.space.S200} ${config.space.S300}`,
  maxWidth: '24rem',
  verticalAlign: 'top',
  border: `1px solid ${color.Surface.ContainerLine}`,
  // Keep prose and long links readable without making a single cell unbounded.
  overflowWrap: 'anywhere',
});

export const Hint = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginTop: config.space.S100,
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  opacity: 0.72,
});
