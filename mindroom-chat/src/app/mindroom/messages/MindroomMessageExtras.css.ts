import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../styles/Glass.css';

export const Extras = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  maxWidth: '100%',
  marginTop: config.space.S200,
});

export const Section = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassOutline,
  {
    maxWidth: '100%',
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const Summary = style({
  cursor: 'pointer',
  padding: `${config.space.S100} ${config.space.S200}`,
  overflowWrap: 'anywhere',
});

export const Content = style({
  minWidth: 0,
  padding: `0 ${config.space.S200} ${config.space.S200}`,
});

export const PlainText = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  fontFamily: 'var(--font-mono)',
  fontSize: toRem(13),
  lineHeight: 1.45,
});

export const Markdown = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const Html = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

globalStyle(`${Html} table`, {
  display: 'block',
  maxWidth: '100%',
  overflowX: 'auto',
  borderCollapse: 'collapse',
});

globalStyle(`${Html} pre`, {
  maxWidth: '100%',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
});

globalStyle(`${Html} code`, {
  overflowWrap: 'anywhere',
});
