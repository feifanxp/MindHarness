import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { footerInset } from './RoomOverlay.css';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

const collapsedMask = 'linear-gradient(to bottom, black calc(100% - 4em), transparent)';

export const CollapsibleContainer = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
});

export const CollapsibleContent = recipe({
  base: { position: 'relative', gridArea: '1 / 1' },
  variants: {
    collapsed: {
      true: { maskImage: collapsedMask, WebkitMaskImage: collapsedMask },
    },
  },
});

const footerBase = style({
  display: 'flex',
  justifyContent: 'flex-end',
  width: '100%',
  pointerEvents: 'none',
});

export const CollapsibleFooter = style([
  footerBase,
  { gridArea: '1 / 1', alignSelf: 'end', zIndex: 1 },
]);

export const CollapsibleStickyFooter = style([
  footerBase,
  {
    position: 'sticky',
    bottom: `calc(${footerInset} + ${config.space.S200})`,
    marginTop: config.space.S200,
    zIndex: 1,
  },
]);

export const CollapsiblePill = style([
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: toRem(32),
    maxWidth: '100%',
    padding: `${config.space.S100} ${config.space.S300}`,
    borderRadius: toRem(8),
    border: 'none',
    color: color.SurfaceVariant.OnContainer,
    fontSize: toRem(13),
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.4,
    textAlign: 'center',
    pointerEvents: 'auto',
    cursor: 'pointer',
    selectors: {
      '&:focus-visible': {
        outline: `2px solid ${color.Primary.Main}`,
        outlineOffset: '2px',
      },
    },
  },
]);
