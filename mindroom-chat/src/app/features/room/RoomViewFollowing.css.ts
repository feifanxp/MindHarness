import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassFlat, glassFloating } from '../../styles/Glass.css';

export const FollowingSurface = style([glassFlat, glassFloating]);

export const RoomViewFollowingPlaceholder = style([
  DefaultReset,
  {
    minHeight: toRem(28),
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
]);

export const RoomViewFollowing = recipe({
  base: [
    DefaultReset,
    {
      minHeight: toRem(28),
      padding: `0 ${config.space.S400}`,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      width: '100%',
      backgroundColor: 'transparent',
      color: color.Surface.OnContainer,
      outline: 'none',
    },
  ],
  variants: {
    clickable: {
      true: {
        cursor: 'pointer',
        selectors: {
          '&:hover, &:focus-visible': {
            color: color.Primary.Main,
          },
          '&:active': {
            color: color.Primary.Main,
          },
        },
      },
    },
  },
});
