import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { transition } from '../../styles/transition';

export const CategoryState = style({
  padding: `${config.space.S200} ${config.space.S300}`,
  color: color.Background.OnContainer,
});

export const RecentlyOpenedPanel = style({
  position: 'relative',
  display: 'flex',
  flex: 'none',
  flexDirection: 'column',
  padding: config.space.S200,
  paddingInlineEnd: 0,
  backgroundColor: color.Background.Container,
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      insetInline: config.space.S400,
      height: config.borderWidth.B300,
      backgroundColor: color.Background.ContainerLine,
      pointerEvents: 'none',
    },
    '&[data-collapsed=true]': {
      maxHeight: 'none',
    },
  },
});

export const RecentlyOpenedResizeHandle = style({
  position: 'absolute',
  zIndex: 1,
  top: '-6px',
  right: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '12px',
  cursor: 'row-resize',
  touchAction: 'none',
  userSelect: 'none',
  ':focus-visible': {
    outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
    outlineOffset: `calc(-1 * ${config.borderWidth.B300})`,
  },
});

export const RecentlyOpenedResizeGrip = style({
  width: config.space.S700,
  height: '3px',
  borderRadius: '999px',
  backgroundColor: color.Background.ContainerLine,
  transition: transition(['background-color']),
  selectors: {
    [`.${RecentlyOpenedResizeHandle}:hover &, .${RecentlyOpenedResizeHandle}:focus-visible &`]: {
      backgroundColor: color.Primary.Main,
    },
  },
});

export const RecentlyOpenedCategory = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
});

// The list scrolls through folds' Scroll, which sets height: 100%. That only
// resolves to the right number inside a box whose height the flex layout has
// already decided, so the sizing lives here and the scrolling lives on the
// child - the same split PageNavContent uses for the room list above.
export const RecentlyOpenedListViewport = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
});

// No paddingInlineEnd: Scroll reserves an 8px gutter for its own scrollbar, and
// the room list above pads to 0 on that side for the same reason. Adding more
// here would step the two lists out of alignment.
export const RecentlyOpenedList = style({
  overscrollBehavior: 'contain',
  paddingBottom: config.space.S200,
});

// Recently Opened rows are two text lines.
// folds line boxes leave 3px of half-leading on each side.
// The old 4px column gap made lines inside a row 10px apart while adjacent rows were only 6px apart.
// That spacing grouped each title with the next row's room name.
// Moving the 4px to the row boundary inverts the proximity without changing the 42px pitch.
export const RecentlyOpenedEntry = style({
  position: 'relative',
  selectors: {
    '& + &': {
      marginTop: config.space.S100,
    },
    // The hairline sits inside the 4px band.
    // Absolute positioning costs no layout height and keeps it outside each hovered row's rounded rect.
    // Insets match NavItemContent's text paddings.
    // The integral -2px offset keeps a 1px rule crisp at DPR 1 instead of antialiasing across two device pixels.
    '& + &::before': {
      content: '""',
      position: 'absolute',
      top: `calc(-1 * ${config.space.S100} / 2)`,
      insetInlineEnd: config.space.S300,
      insetInlineStart: config.space.S200,
      height: config.borderWidth.B300,
      backgroundColor: color.Background.ContainerLine,
      pointerEvents: 'none',
    },
  },
});

export const Entry = style({
  position: 'relative',
});

export const EntrySummary = style({
  minWidth: 0,
});

export const EntryUnreadDot = style({
  width: '6px',
  height: '6px',
  flexShrink: 0,
  borderRadius: '999px',
  backgroundColor: color.Primary.Main,
});

export const EntryActions = style({
  position: 'absolute',
  insetBlock: 0,
  insetInlineEnd: 0,
  paddingInlineStart: config.space.S600,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: 'inherit',
  background: `linear-gradient(to right, transparent, ${color.Background.ContainerHover} 45%)`,
  transition: transition(['opacity']),

  selectors: {
    [`.${Entry}:hover &, .${Entry}:focus-within &`]: {
      opacity: 1,
      visibility: 'visible',
      pointerEvents: 'auto',
    },
    [`.${Entry}[aria-selected='true'] &`]: {
      background: `linear-gradient(to right, transparent, ${color.Background.ContainerActive} 45%)`,
    },
    'html[dir=rtl] &': {
      background: `linear-gradient(to left, transparent, ${color.Background.ContainerHover} 45%)`,
    },
    [`html[dir=rtl] .${Entry}[aria-selected='true'] &`]: {
      background: `linear-gradient(to left, transparent, ${color.Background.ContainerActive} 45%)`,
    },
  },
});

export const EntryPinButtonPinned = style({
  color: color.Primary.Main,
});

export const EntryTooltip = style({
  padding: config.space.S300,
});

export const EntryTooltipDetails = style({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: `${config.space.S100} ${config.space.S300}`,
  alignItems: 'baseline',
});
