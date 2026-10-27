import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const FileRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  padding: `${config.space.S200} ${config.space.S200} ${config.space.S200} ${config.space.S300}`,
});

export const FileTile = style({
  flexShrink: 0,
  width: toRem(36),
  height: toRem(42),
  borderRadius: config.radii.R300,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
  display: 'grid',
  placeItems: 'end center',
  paddingBottom: toRem(6),
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W700,
  letterSpacing: '0.02em',
});

export const FileInfo = style({
  minWidth: 0,
  flexGrow: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
});

export const FileName = style({
  fontWeight: config.fontWeight.W600,
});
