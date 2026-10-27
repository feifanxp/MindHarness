import { style } from '@vanilla-extract/css';
import { color, config, DefaultReset } from 'folds';
import * as disclosure from './MessageDisclosure.css';

const BlockSpacing = style({
  marginBottom: config.space.S200,
  marginTop: config.space.S200,
  selectors: {
    '&:first-child': {
      marginTop: 0,
    },
    '&:last-child': {
      marginBottom: 0,
    },
  },
});

const BaseCode = style({
  color: color.SurfaceVariant.OnContainer,
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
});

export const Block = style([DefaultReset, BlockSpacing, disclosure.Surface]);

export const BlockHeader = disclosure.Header;

export const BlockHeaderMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const BlockBody = disclosure.Body;

export const PasteMarkerBadge = style([
  DefaultReset,
  BaseCode,
  {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: '100%',
    gap: config.space.S100,
    verticalAlign: 'middle',
    padding: `0 ${config.space.S100}`,
    lineHeight: 1.6,
  },
]);

export const PasteMarkerBadgeMeta = style({
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  gap: config.space.S100,
  color: color.SurfaceVariant.OnContainer,
});

export { Chevron as BlockChevron } from './MessageDisclosure.css';
