import { describe, expect, it } from 'vitest';

import {
  INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX,
  INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT,
  INVITE_AUTOCOMPLETE_MENU_OFFSET_PX,
  getInviteAutocompleteMenuMaxHeight,
  getInviteAutocompleteMenuPlacement,
} from './inviteAutocompleteMenuPlacement';

describe('getInviteAutocompleteMenuPlacement', () => {
  it('opens below the input when the full menu height fits below', () => {
    expect(getInviteAutocompleteMenuPlacement({ y: 100, height: 40 }, 1000)).toBe('Bottom');
  });

  it('flips above the input when there is no room below but room above', () => {
    expect(getInviteAutocompleteMenuPlacement({ y: 900, height: 40 }, 1000)).toBe('Top');
  });

  it('prefers the larger side when the menu fits on neither side', () => {
    // requiredHeight = min(300 * 0.52, 448) + 8 = 164; both sides below it.
    expect(getInviteAutocompleteMenuPlacement({ y: 100, height: 40 }, 300)).toBe('Bottom');
    expect(getInviteAutocompleteMenuPlacement({ y: 140, height: 40 }, 300)).toBe('Top');
  });

  it('caps the required height at the fixed pixel maximum on tall viewports', () => {
    const viewportHeight = 2000;
    const anchorTop = viewportHeight - INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX - 40 - 16;

    expect((viewportHeight * INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT) / 100).toBeGreaterThan(
      INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX
    );
    expect(getInviteAutocompleteMenuPlacement({ y: anchorTop, height: 40 }, viewportHeight)).toBe(
      'Bottom'
    );
  });
});

describe('getInviteAutocompleteMenuMaxHeight', () => {
  it('keeps the CSS cap when the chosen side has plenty of room', () => {
    expect(getInviteAutocompleteMenuMaxHeight({ y: 40, height: 40 }, 2000, 'Bottom')).toBe(
      INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX
    );
  });

  it('clamps to the space below the input so folds never repositions sideways', () => {
    const anchor = { y: 300, height: 40 };
    const viewportHeight = 500;

    expect(getInviteAutocompleteMenuMaxHeight(anchor, viewportHeight, 'Bottom')).toBe(
      viewportHeight - (anchor.y + anchor.height) - INVITE_AUTOCOMPLETE_MENU_OFFSET_PX
    );
  });

  it('clamps to the space above the input when flipped', () => {
    const anchor = { y: 200, height: 40 };

    expect(getInviteAutocompleteMenuMaxHeight(anchor, 500, 'Top')).toBe(
      anchor.y - INVITE_AUTOCOMPLETE_MENU_OFFSET_PX
    );
  });

  it('never returns a negative height', () => {
    expect(getInviteAutocompleteMenuMaxHeight({ y: 0, height: 40 }, 30, 'Top')).toBe(0);
  });
});
