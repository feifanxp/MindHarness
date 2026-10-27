import { createVar, style } from '@vanilla-extract/css';
import { recipe, RecipeVariants } from '@vanilla-extract/recipes';
import { color, config, DefaultReset, Disabled, FocusOutline, toRem } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';
import { glassFlat, glassFloating, glassSurface } from '../../styles/Glass.css';

export const Sidebar = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'Background' }),
  glassFlat,
  glassFloating,
  {
    width: toRem(66),
    display: 'flex',
    flexDirection: 'column',
    color: color.Background.OnContainer,
  },
]);

export const SidebarStack = style([
  DefaultReset,
  {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: config.space.S300,
    padding: `${config.space.S300} 0`,
  },
]);

const DropLineDist = createVar();
export const DropTarget = style({
  vars: {
    [DropLineDist]: toRem(-8),
  },

  selectors: {
    '&[data-inside-folder=true]': {
      vars: {
        [DropLineDist]: toRem(-6),
      },
    },
    '&[data-drop-child=true]': {
      outline: `${config.borderWidth.B700} solid ${color.Success.Main}`,
      borderRadius: config.radii.R400,
    },
    '&[data-drop-above=true]::after, &[data-drop-below=true]::after': {
      content: '',
      display: 'block',
      position: 'absolute',
      insetInlineStart: toRem(0),
      width: '100%',
      height: config.borderWidth.B700,
      backgroundColor: color.Success.Main,
    },
    '&[data-drop-above=true]::after': {
      top: DropLineDist,
    },
    '&[data-drop-below=true]::after': {
      bottom: DropLineDist,
    },
  },
});

const webkitUserDrag = {
  WebkitUserDrag: 'none',
} as Record<string, string>;

export const SidebarDragSource = style({
  touchAction: 'none',
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  ...webkitUserDrag,
});

export const SidebarRowDragSource = style({
  touchAction: 'pan-y',
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  ...webkitUserDrag,
});

const PUSH_X = 2;
export const SidebarItem = recipe({
  base: [
    DefaultReset,
    {
      minWidth: toRem(42),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      transition: transition(['transform'], motion.duration.Slow, motion.easing.Decelerate),

      selectors: {
        '&:hover': {
          transform: `translateX(${toRem(PUSH_X)})`,
        },
        'html[dir="rtl"] &:hover': { transform: `translateX(${toRem(-PUSH_X)})` },
        '&::before': {
          content: '',
          display: 'none',
          position: 'absolute',
          insetInlineStart: toRem(-11.5 - PUSH_X),
          width: toRem(3 + PUSH_X),
          height: toRem(16),
          borderStartEndRadius: toRem(4),
          borderEndEndRadius: toRem(4),
          background: 'CurrentColor',
          transition: transition(['height'], motion.duration.Slow, motion.easing.Linear),
        },
        '&:hover::before': {
          display: 'block',
          width: toRem(3),
        },
      },
    },
    Disabled,
    DropTarget,
  ],
  variants: {
    active: {
      true: {
        selectors: {
          '&::before': {
            display: 'block',
            height: toRem(24),
          },
          '&:hover::before': {
            width: toRem(3 + PUSH_X),
          },
        },
      },
    },
  },
});
export type SidebarItemVariants = RecipeVariants<typeof SidebarItem>;

export const SidebarItemBadge = recipe({
  base: [
    DefaultReset,
    {
      pointerEvents: 'none',
      position: 'absolute',
      zIndex: 1,
      lineHeight: 0,
    },
  ],
  variants: {
    hasCount: {
      true: {
        top: toRem(-6),
        insetInlineStart: toRem(-6),
      },
      false: {
        top: toRem(-2),
        insetInlineStart: toRem(-2),
      },
    },
  },
  defaultVariants: {
    hasCount: false,
  },
});
export type SidebarItemBadgeVariants = RecipeVariants<typeof SidebarItemBadge>;

export const SidebarAvatar = recipe({
  base: [
    glassSurface({ level: 'control', variant: 'Background' }),
    {
      selectors: {
        'button&': {
          cursor: 'pointer',
        },
      },
    },
  ],
  variants: {
    size: {
      '200': {
        width: toRem(16),
        height: toRem(16),
        fontSize: toRem(10),
        lineHeight: config.lineHeight.T200,
        letterSpacing: config.letterSpacing.T200,
      },
      '300': {
        width: toRem(34),
        height: toRem(34),
      },
      '400': {
        width: toRem(42),
        height: toRem(42),
      },
    },
    outlined: {
      true: {
        border: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
      },
    },
  },
  defaultVariants: {
    size: '400',
  },
});
export type SidebarAvatarVariants = RecipeVariants<typeof SidebarAvatar>;

export const SidebarFolder = recipe({
  base: [
    ContainerColor({ variant: 'Background' }),
    glassSurface({ level: 'control', variant: 'Background' }),
    {
      padding: config.space.S100,
      width: toRem(42),
      minHeight: toRem(42),
      display: 'flex',
      flexWrap: 'wrap',
      outline: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
      position: 'relative',

      selectors: {
        'button&': {
          cursor: 'pointer',
        },
      },
    },
    FocusOutline,
    DropTarget,
  ],
  variants: {
    state: {
      Close: {
        gap: toRem(2),
        borderRadius: config.radii.R400,
      },
      Open: {
        paddingInlineStart: 0,
        paddingInlineEnd: 0,
        flexDirection: 'column',
        alignItems: 'center',
        gap: config.space.S200,
        borderRadius: config.radii.R500,
      },
    },
  },
  defaultVariants: {
    state: 'Close',
  },
});
export type SidebarFolderVariants = RecipeVariants<typeof SidebarFolder>;

export const SidebarFolderDropTarget = recipe({
  base: {
    width: '100%',
    height: toRem(8),
    position: 'absolute',
    insetInlineStart: 0,
  },
  variants: {
    position: {
      Top: {
        top: toRem(-4),
      },
      Bottom: {
        bottom: toRem(-4),
      },
    },
  },
});
export type SidebarFolderDropTargetVariants = RecipeVariants<typeof SidebarFolderDropTarget>;
