import { keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ThreadIndicator = style({
  alignSelf: 'flex-start',
  width: 'fit-content',
  maxWidth: '100%',
  minWidth: 0,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  flexWrap: 'wrap',
  rowGap: config.space.S100,

  selectors: {
    'button&': {
      cursor: 'pointer',
    },
    'button&:hover, button&:focus-visible': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
      borderColor: color.SurfaceVariant.ContainerLine,
    },
    'button&:active': {
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
  },
});

export const ThreadIndicatorResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const ThreadParticipants = style({
  flexShrink: 0,
});

export const ThreadParticipant = style({
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.Container}`,
});

export const ThreadActivity = style({
  minWidth: 0,
  flexShrink: 1,
  flexWrap: 'wrap',
  rowGap: config.space.S100,
});

export const ThreadSeparator = style({
  opacity: config.opacity.P300,
});

export const ThreadTimestamp = style({
  opacity: config.opacity.P300,
  whiteSpace: 'nowrap',
});

const ThreadStreamingPulse = keyframes({
  '0%': {
    opacity: config.opacity.P300,
    transform: 'scale(0.85)',
  },
  '50%': {
    opacity: config.opacity.P500,
    transform: 'scale(1)',
  },
  '100%': {
    opacity: config.opacity.P300,
    transform: 'scale(0.85)',
  },
});

export const ThreadStreamingDot = style({
  width: toRem(6),
  height: toRem(6),
  flexShrink: 0,
  borderRadius: '50%',
  backgroundColor: color.Success.Main,
  animation: `${ThreadStreamingPulse} 1.5s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

export const ThreadUnreadDot = style({
  width: toRem(8),
  height: toRem(8),
  flexShrink: 0,
  borderRadius: '50%',
  backgroundColor: color.Primary.Main,
});

export const ThreadScheduledIndicator = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const ThreadScheduledIcon = style({
  flexShrink: 0,
  color: color.Warning.Main,
});
