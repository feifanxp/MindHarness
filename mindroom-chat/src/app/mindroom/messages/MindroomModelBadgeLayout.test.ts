import { config, toRem } from 'folds';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_AVATAR_SIZE,
  MESSAGE_AVATAR_WIDTH_PX,
  MESSAGE_LAYOUT_GAP,
  MESSAGE_LAYOUT_GAP_SPACE_KEY,
} from '../../components/message/layout/config';
import { getMindroomModelBadgeMaxWidth } from './modelBadgeLayout';

describe('Mindroom model badge avatar layout', () => {
  it('derives the badge overflow from the same avatar and gap tokens as message layouts', () => {
    const avatarWidth = toRem(MESSAGE_AVATAR_WIDTH_PX);
    const messageLayoutGap = config.space[MESSAGE_LAYOUT_GAP_SPACE_KEY];

    expect(MESSAGE_AVATAR_SIZE).toBe('300');
    expect(MESSAGE_AVATAR_WIDTH_PX).toBe(36);
    expect(MESSAGE_LAYOUT_GAP).toBe('300');
    expect(getMindroomModelBadgeMaxWidth(avatarWidth, messageLayoutGap)).toBe(
      `calc(${avatarWidth} + ${messageLayoutGap} + ${messageLayoutGap})`
    );
  });
});
