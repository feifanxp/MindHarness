import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, DefaultReset, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

// Inline tool activity shares one quiet disclosure surface and hit target.
export const Surface = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    overflow: 'hidden',
  },
]);

export const Header = style([
  DefaultReset,
  {
    width: '100%',
    minHeight: toRem(36),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: config.space.S200,
    padding: `${config.space.S200} ${config.space.S300}`,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
    fontSize: toRem(12),
    fontWeight: config.fontWeight.W500,
    lineHeight: 1.4,
    listStyle: 'none',
    selectors: {
      '&:hover': {
        background: `color-mix(in srgb, ${color.SurfaceVariant.ContainerHover} 40%, transparent)`,
      },
      '&:focus-visible': {
        outline: `2px solid ${color.Primary.Main}`,
        outlineOffset: '-2px',
      },
    },
  },
]);
globalStyle(`${Header}::-webkit-details-marker`, { display: 'none' });

export const Label = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const Meta = style({
  flexShrink: 0,
  fontWeight: config.fontWeight.W400,
  whiteSpace: 'nowrap',
  opacity: 0.7,
});

export const Chevron = style({
  flexShrink: 0,
  selectors: { 'details[open] > summary &': { transform: 'rotate(180deg)' } },
});

export const Body = style({
  borderTop: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `${config.space.S200} ${config.space.S300}`,
});
