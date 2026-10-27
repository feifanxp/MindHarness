import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import {
  MESSAGE_AVATAR_WIDTH_PX,
  MESSAGE_LAYOUT_GAP_SPACE_KEY,
} from '../../components/message/layout/config';
import { getMindroomModelBadgeMaxWidth } from './modelBadgeLayout';

const messageLayoutGap = config.space[MESSAGE_LAYOUT_GAP_SPACE_KEY];

export const Badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: toRem(2),
  boxSizing: 'border-box',
  // Let the badge overflow the avatar by exactly the shared layout gap on either side.
  maxWidth: getMindroomModelBadgeMaxWidth(toRem(MESSAGE_AVATAR_WIDTH_PX), messageLayoutGap),
  minHeight: toRem(14),
  padding: `0 ${toRem(4)}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: toRem(999),
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(9),
  fontWeight: 550,
  lineHeight: toRem(12),
  letterSpacing: toRem(0.1),
});

export const Icon = style({
  flexShrink: 0,
});

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});
