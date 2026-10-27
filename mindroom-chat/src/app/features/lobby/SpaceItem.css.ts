import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { recipe } from '@vanilla-extract/recipes';

export const SpaceItemCard = recipe({
  base: {
    paddingBottom: config.space.S100,
    borderBottom: `${config.borderWidth.B300} solid transparent`,
    position: 'relative',
    selectors: {
      '&[data-dragging=true]': {
        opacity: config.opacity.Disabled,
      },
    },
  },
  variants: {
    outlined: {
      true: {
        borderBottomColor: color.Surface.ContainerLine,
      },
    },
  },
});
export const HeaderChip = style({
  paddingInlineStart: config.space.S200,
  selectors: {
    [`&[data-ui-before="true"]`]: {
      paddingInlineStart: config.space.S100,
    },
  },
});
export const HeaderChipPlaceholder = style([
  {
    borderRadius: config.radii.R400,
    paddingInlineStart: config.space.S100,
    paddingInlineEnd: config.space.S300,
    height: toRem(32),
  },
]);
