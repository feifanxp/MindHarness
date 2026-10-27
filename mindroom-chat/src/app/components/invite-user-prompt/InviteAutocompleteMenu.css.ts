import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

export const InviteAutocompleteMenuRoot = style([DefaultReset]);

/**
 * The folds PopOut wrapper is a full-viewport fixed layer; a combobox must
 * keep the input and the rest of the page clickable while suggestions are
 * open, so pointer events pass through everywhere except the menu itself.
 */
export const InviteAutocompletePopOut = style([
  DefaultReset,
  {
    pointerEvents: 'none',
  },
]);

export const InviteAutocompleteMenuContainer = style([
  DefaultReset,
  {
    pointerEvents: 'auto',
  },
]);

// Height is clamped by the inline maxHeight computed alongside the anchor in
// InviteAutocompleteMenu.tsx (side-space aware); no CSS clamp so there is a
// single source of truth.
export const InviteAutocompleteMenu = style([
  DefaultReset,
  {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
]);

export const InviteAutocompleteMenuHeader = style([
  DefaultReset,
  { padding: `0 ${config.space.S300}`, flexShrink: 0 },
]);

export const InviteAutocompleteOption = style([
  DefaultReset,
  {
    alignItems: 'flex-start',
    height: 'auto',
    minHeight: toRem(56),
    paddingTop: config.space.S200,
    paddingBottom: config.space.S200,
    selectors: {
      // Rows are transparent at rest; the option Enter or Tab picks needs its own fill.
      '&[aria-selected="true"]': { backgroundColor: color.Surface.ContainerHover },
    },
  },
]);

export const InviteAutocompleteIdentity = style([
  DefaultReset,
  {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: config.space.S100,
    flexGrow: 1,
  },
]);

export const InviteAutocompleteDisplayName = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const InviteAutocompleteUserId = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});
