import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';
import { MESSAGE_AVATAR_WIDTH_PX } from '../../../components/message/layout/config';

export const MessageBase = style({
  position: 'relative',
});
export const MessageBaseBubbleCollapsed = style({
  paddingTop: 0,
});

export const MessageContentWithDisclosure = style({
  selectors: {
    '&:has([data-message-disclosure])': { width: '100%' },
  },
});

export const MessageOptionsBase = style([
  DefaultReset,
  {
    position: 'absolute',
    top: toRem(-30),
    insetInlineEnd: 0,
    zIndex: 1,
  },
]);
export const MessageOptionsBar = style([
  DefaultReset,
  {
    padding: config.space.S100,
  },
]);

export const BubbleAvatarBase = style({
  paddingTop: 0,
});

export const MessageAvatar = style({
  cursor: 'pointer',
});

export const MessageAvatarWithModel = style({
  flexDirection: 'column',
  alignItems: 'center',
  gap: toRem(3),
  // Match Avatar size="300" so the wider badge does not shift the message grid.
  width: toRem(MESSAGE_AVATAR_WIDTH_PX),
});

export const MessageQuickReaction = style({
  minWidth: toRem(32),
});

export const MessageMenuGroup = style({
  padding: config.space.S100,
});

export const MessageMenuItemText = style({
  flexGrow: 1,
});

export const ReactionsContainer = style({
  selectors: {
    '&:empty': {
      display: 'none',
    },
  },
});

export const ReactionsTooltipText = style({
  wordBreak: 'break-word',
});
