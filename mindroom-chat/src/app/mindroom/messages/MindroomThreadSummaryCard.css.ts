import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

export const ThreadSummaryCard = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    alignSelf: 'flex-start',
    width: 'fit-content',
    minWidth: 0,
    maxWidth: `min(100%, ${toRem(420)})`,
    padding: config.space.S200,
    borderRadius: config.radii.R300,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const ThreadSummaryHeader = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
});

export const ThreadSummaryLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.72,
});

export const ThreadSummaryBody = style({
  minWidth: 0,
  margin: 0,
  fontSize: toRem(15),
  fontWeight: 500,
  lineHeight: toRem(22),
});

export const ThreadSummaryBodyCompact = style({
  minWidth: 0,
  margin: 0,
  fontSize: toRem(15),
  fontWeight: 500,
  lineHeight: toRem(22),
});
