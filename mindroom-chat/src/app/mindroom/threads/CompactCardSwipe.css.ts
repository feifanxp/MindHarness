import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { motion } from '../../styles/Motion.css';
import { transition } from '../../styles/transition';

export const SwipeTrack = style({
  position: 'relative',
  minWidth: 0,
});

// The browser keeps vertical scrolling and pinch zoom; horizontal movement
// reaches the swipe handlers instead of panning anything.
export const SwipeTrackEnabled = style({
  touchAction: 'pan-y pinch-zoom',
});

export const SwipeTrackSettling = style({
  transition: transition(['transform'], motion.duration.Normal, motion.easing.Decelerate),
});

// Sits under the card and shows through as the card slides away, like the
// swipe actions of an iOS list row.
export const SwipeAction = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: config.space.S200,
  paddingInline: config.space.S400,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.ContainerActive,
  color: color.SurfaceVariant.OnContainer,
  pointerEvents: 'none',
  transition: transition(['background-color', 'color']),
  selectors: {
    '&[data-armed="true"]': {
      backgroundColor: color.Success.Main,
      color: color.Success.OnMain,
    },
    '&[data-armed="true"][data-resolved="true"]': {
      backgroundColor: color.Primary.Main,
      color: color.Primary.OnMain,
    },
  },
});
