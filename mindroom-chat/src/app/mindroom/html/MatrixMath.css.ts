import { globalStyle, style } from '@vanilla-extract/css';
import { config, DefaultReset } from 'folds';
import { MarginSpaced } from '../../styles/CustomHtml.css';

export const MathInline = style([
  DefaultReset,
  {
    display: 'inline-block',
    maxWidth: '100%',
    verticalAlign: 'middle',
    color: 'inherit',
  },
]);

export const MathBlock = style([
  DefaultReset,
  MarginSpaced,
  {
    display: 'block',
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    textAlign: 'center',
    color: 'inherit',
  },
]);

globalStyle(`${MathInline} .katex, ${MathBlock} .katex`, {
  color: 'inherit',
});

globalStyle(`${MathInline} .katex`, {
  fontSize: '1em',
});

globalStyle(`${MathInline} .katex-display, ${MathBlock} .katex-display`, {
  margin: 0,
});

globalStyle(`${MathBlock} .katex-display`, {
  overflowX: 'auto',
  overflowY: 'hidden',
  padding: `0 ${config.space.S100}`,
});

globalStyle(`${MathInline} .katex-error, ${MathBlock} .katex-error`, {
  color: 'inherit',
});
