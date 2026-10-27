import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { footerInset, topInset, Scroll } from './RoomOverlay.css';
import { transition } from '../../styles/transition';

const touchActions = '(max-width: 480px), (hover: none)';

export const View = style([
  Scroll,
  {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    padding: `${topInset} ${config.space.S300} calc(${footerInset} + ${config.space.S300})`,
    overflowY: 'auto',
    overflowX: 'hidden',
    width: '100%',
  },
]);

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '8rem',
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
});

export const CardShell = style({
  position: 'relative',
  width: '100%',
  minWidth: 0,
});

export const PinnedSection = style({
  paddingBlockEnd: config.space.S300,
});

export const Card = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    width: '100%',
    minWidth: 0,
    padding: `${config.space.S200} ${config.space.S300}`,
    borderRadius: config.radii.R300,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    textAlign: 'start',
    cursor: 'pointer',
    transition: transition(['background-color', 'border-color']),
    ':hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

globalStyle(`${CardShell}:hover ${Card}, ${CardShell}:focus-within ${Card}`, {
  backgroundColor: color.SurfaceVariant.ContainerHover,
});

export const CardAction = style({
  display: 'flex',
  gap: config.space.S100,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  position: 'absolute',
  insetInlineEnd: config.space.S300,
  top: '50%',
  zIndex: 1,
  opacity: 0,
  pointerEvents: 'none',
  transform: 'translateY(-50%)',
  transition: transition(['opacity']),
  '@media': {
    [touchActions]: {
      insetInlineEnd: config.space.S100,
      top: 'auto',
      // Centers the 2.5rem button on the card's last row (24px tall, above
      // an S200 padding and the border).
      bottom: `calc(${config.borderWidth.B300} + ${config.space.S200} + ${toRem(12)} - 1.25rem)`,
      transform: 'none',
      opacity: 1,
      pointerEvents: 'auto',
      backgroundColor: 'transparent',
      selectors: {
        '&::before': {
          display: 'none',
        },
      },
    },
  },
  selectors: {
    '&::before': {
      content: "''",
      position: 'absolute',
      insetBlock: 0,
      insetInlineStart: `calc(-1 * ${config.space.S500})`,
      width: config.space.S500,
      pointerEvents: 'none',
      background: `linear-gradient(to right, transparent, ${color.SurfaceVariant.ContainerHover})`,
    },
  },
});

export const CardQuickAction = style({
  '@media': {
    [touchActions]: {
      display: 'none',
    },
  },
});

export const CardMenuButton = style({
  '@media': {
    [touchActions]: {
      width: '2.5rem',
      height: '2.5rem',
    },
  },
});

globalStyle(`[dir='rtl'] ${CardAction}::before`, {
  background: `linear-gradient(to left, transparent, ${color.SurfaceVariant.ContainerHover})`,
});

globalStyle(`${CardShell}:hover ${CardAction}, ${CardShell}:focus-within ${CardAction}`, {
  opacity: 1,
  pointerEvents: 'auto',
});

export const CardUnread = style({
  boxShadow: `inset ${toRem(3)} 0 0 ${color.Primary.Main}`,
});

globalStyle(`[dir='rtl'] ${CardUnread}`, {
  boxShadow: `inset -${toRem(3)} 0 0 ${color.Primary.Main}`,
});

export const CardResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: config.space.S200,
  minWidth: 0,
});

export const TitleText = style({
  minWidth: 0,
  flex: 1,
  overflowWrap: 'anywhere',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const TimeText = style({
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const TimeTextUnread = style({
  color: color.Primary.Main,
  fontWeight: config.fontWeight.W600,
  opacity: 1,
});

export const MessagePreview = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
});

export const MessageText = style({
  minWidth: 0,
  flex: 1,
});

export const MetadataRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  rowGap: config.space.S100,
  minWidth: 0,
  minHeight: toRem(24),
  flexWrap: 'wrap',
});

// Room for the menu button that sits at the end of this row on touch; only
// the compact view's card shell has that button.
globalStyle(`${CardShell} ${MetadataRow}`, {
  '@media': {
    [touchActions]: {
      paddingInlineEnd: toRem(32),
    },
  },
});

export const Participants = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const ParticipantAvatar = style({
  flexShrink: 0,
});

export const ResolutionByline = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  minWidth: 0,
  maxWidth: '100%',
  color: color.Success.Main,
});

export const ResolutionBylineLabel = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const StreamingStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const Stats = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S200,
  flexShrink: 0,
  marginInlineStart: 'auto',
});

export const ScheduledIndicator = style({
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const ReplyCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(3),
  whiteSpace: 'nowrap',
});
