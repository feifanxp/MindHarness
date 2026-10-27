import { createVar, fallbackVar, style } from '@vanilla-extract/css';
import { recipe, RecipeVariants } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { Viewport } from '../inset-scrollbar/InsetScrollbar.css';

// Match the size-600 navigation header and its native focus-scroll inset.
const pageNavHeaderHeight = toRem(54);
// folds' Scroll pads its inline end for an overlay scrollbar whenever the native
// one measures 0 px, which these hidden-scrollbar viewports always do. Sticky
// headers span that padding so no strip of the content shows beside them.
const pageNavScrollEndPadding = toRem(8);
const pageScrollEndPadding = createVar();

export const pageScrollHeaderHeight = createVar();
const scrollHeaderHeight = fallbackVar(pageScrollHeaderHeight, pageNavHeaderHeight);

export const PageScroll = recipe({
  base: [Viewport, { scrollPaddingBlockStart: 0 }],
  variants: { header: { true: { scrollPaddingBlockStart: scrollHeaderHeight } } },
});

export const PageScrollContent = style({ minHeight: '100%' });
export const PageScrollHeader = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  vars: { [pageScrollEndPadding]: toRem(16) },
  marginInlineEnd: `calc(-1 * ${pageScrollEndPadding})`,
});
export const PageScrollBody = style({
  paddingInlineEnd: 'calc(var(--mr-scrollbar-inset-end, 0px) + 12px)',
});
export const PageScrollbar = recipe({
  base: { top: 0, bottom: 0, insetInlineEnd: 'var(--mr-scrollbar-inset-end, 0px)', zIndex: 1 },
  variants: { header: { true: { top: scrollHeaderHeight } } },
});
export const PageScrollToTop = style({
  selectors: { '&&': { top: `calc(${scrollHeaderHeight} + ${config.space.S200})` } },
});

export const PageNav = recipe({
  variants: {
    size: {
      '400': {
        width: toRem(256),
      },
      '300': {
        width: toRem(222),
      },
    },
  },
  defaultVariants: {
    size: '400',
  },
});
export type PageNavVariants = RecipeVariants<typeof PageNav>;

export const PageNavHeader = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  height: pageNavHeaderHeight,
  padding: `0 ${config.space.S200} 0 ${config.space.S300}`,
  // The extra end padding keeps the header's contents in place.
  marginInlineEnd: `calc(-1 * ${pageNavScrollEndPadding})`,
  paddingInlineEnd: `calc(${config.space.S200} + ${pageNavScrollEndPadding})`,
  flexShrink: 0,
  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    'button&[aria-pressed=true]': {
      backgroundColor: color.Background.ContainerActive,
    },
    'button&:hover, button&:focus-visible': {
      backgroundColor: color.Background.ContainerHover,
    },
    'button&:active': {
      backgroundColor: color.Background.ContainerActive,
    },
  },
});

export const PageNavContent = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: `calc(100% - ${pageNavHeaderHeight})`,
  padding: config.space.S200,
  paddingInlineEnd: 'calc(var(--mr-scrollbar-inset-end, 0px) + 12px)',
  paddingBottom: config.space.S700,
});

export const PageNavHeaderScroll = style([
  Viewport,
  { scrollPaddingBlockStart: pageNavHeaderHeight },
]);

export const PageNavScrollbar = style({
  top: pageNavHeaderHeight,
  bottom: 0,
  insetInlineEnd: 'var(--mr-scrollbar-inset-end, 0px)',
  zIndex: 1,
});

export const PageHeader = recipe({
  base: {
    paddingInlineStart: config.space.S400,
    // Inside PageScroll the header spans the viewport's end padding; keep its contents in place.
    paddingInlineEnd: `calc(${config.space.S200} + ${fallbackVar(pageScrollEndPadding, '0px')})`,
  },
  variants: {
    balance: {
      true: {
        paddingInlineStart: config.space.S200,
      },
    },
    outlined: {
      true: {
        borderBottomWidth: config.borderWidth.B300,
      },
    },
  },
  defaultVariants: {
    outlined: true,
  },
});
export type PageHeaderVariants = RecipeVariants<typeof PageHeader>;

export const PageContent = style([
  DefaultReset,
  {
    paddingTop: config.space.S400,
    paddingInlineStart: config.space.S400,
    paddingInlineEnd: 0,
    paddingBottom: toRem(100),
  },
]);

export const PageHeroEmpty = style([
  DefaultReset,
  {
    padding: config.space.S400,
    borderRadius: config.radii.R400,
    minHeight: toRem(450),
  },
]);

export const PageHeroSection = style([
  DefaultReset,
  {
    padding: '40px 0',
    maxWidth: toRem(466),
    width: '100%',
    margin: 'auto',
  },
]);

export const PageContentCenter = style([
  DefaultReset,
  {
    maxWidth: toRem(964),
    width: '100%',
    margin: 'auto',
  },
]);
