import { style } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../../styles/Glass.css';

export const Attachment = recipe({
  base: [
    glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
    {
      color: color.SurfaceVariant.OnContainer,
      borderRadius: config.radii.R400,
      overflow: 'hidden',
      maxWidth: '100%',
      width: toRem(400),
    },
  ],
  variants: {
    outlined: {
      true: glassOutline,
    },
  },
});

export type AttachmentVariants = RecipeVariants<typeof Attachment>;

export const AttachmentHeader = style({
  padding: config.space.S300,
});

export const AttachmentBox = style([
  DefaultReset,
  {
    maxWidth: '100%',
    maxHeight: toRem(600),
    width: toRem(400),
    overflow: 'hidden',
  },
]);

export const AttachmentContent = style({
  padding: config.space.S300,
  paddingTop: 0,
});
