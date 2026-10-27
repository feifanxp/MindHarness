import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const MembersDrawer = style({
  width: toRem(266),
});

export const MemberDrawerContentBase = style({
  position: 'relative',
  overflow: 'hidden',
});

// The counts stack in a column, which sizes each to its text; cap them so they truncate.
export const MembersHeaderCount = style({
  maxWidth: '100%',
});

// The chip has no fill, so drop its inset and line its label up with the member count.
export const MembersHeaderInvited = style({
  maxWidth: '100%',
  selectors: { '&&': { paddingInline: 0 } },
});

export const MembersHeaderControl = style({
  selectors: {
    // Keep the header backdrop visible through Folds' hover/pressed fills.
    // Keyboard focus still uses the native outline.
    '&&&': { backgroundColor: 'transparent' },
  },
});

export const MembersGroupLabel = style({
  padding: config.space.S200,
  selectors: {
    '&:not(:first-child)': {
      paddingTop: config.space.S500,
    },
  },
});

export const DrawerVirtualItem = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
});

export const JoinRequestItem = style({
  marginInlineEnd: config.space.S200,
  padding: config.space.S200,
  borderRadius: config.radii.R400,
  backgroundColor: color.Surface.Container,
});

export const JoinRequestMessage = style({
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});

export const JoinRequestActions = style({
  width: '100%',
});
