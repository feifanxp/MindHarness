import { style } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { RadiiVariant, color, config } from 'folds';
import { glassOutline, glassSurface } from '../../styles/Glass.css';

export const UploadCard = recipe({
  base: [
    glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
    {
      padding: config.space.S300,
      color: color.SurfaceVariant.OnContainer,
    },
  ],
  variants: {
    radii: RadiiVariant,
    outlined: {
      true: glassOutline,
    },
    compact: {
      true: {
        padding: config.space.S100,
      },
    },
  },
  defaultVariants: {
    radii: '400',
  },
});

export type UploadCardVariant = RecipeVariants<typeof UploadCard>;

export const UploadCardError = style({
  padding: `0 ${config.space.S100}`,
  color: color.Critical.Main,
});
