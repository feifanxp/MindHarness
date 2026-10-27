/**
 * Shared layout constants for the invite autocomplete suggestion menu. The
 * menu renders in a viewport portal (folds `PopOut`), so placement must be
 * computed from the input's viewport rect instead of CSS containment.
 */
export const INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX = 448;
export const INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT = 52;
export const INVITE_AUTOCOMPLETE_MENU_OFFSET_PX = 8;

export type InviteAutocompleteMenuPlacement = 'Bottom' | 'Top';

export type InviteAutocompleteMenuAnchorRect = {
  y: number;
  height: number;
};

/**
 * Prefer opening below the input; flip above only when the menu's maximum
 * height cannot fit below but can fit (or fits better) above.
 */
export const getInviteAutocompleteMenuPlacement = (
  anchor: InviteAutocompleteMenuAnchorRect,
  viewportHeight: number
): InviteAutocompleteMenuPlacement => {
  const requiredHeight =
    Math.min(
      (viewportHeight * INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT) / 100,
      INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX
    ) + INVITE_AUTOCOMPLETE_MENU_OFFSET_PX;
  const spaceBelow = viewportHeight - (anchor.y + anchor.height);
  if (spaceBelow >= requiredHeight) return 'Bottom';

  const spaceAbove = anchor.y;
  if (spaceAbove >= requiredHeight) return 'Top';

  return spaceBelow >= spaceAbove ? 'Bottom' : 'Top';
};

/**
 * Clamp the menu height to the space actually available on the chosen side,
 * so folds' own fit-check always passes and never falls back to positioning
 * the menu beside the input.
 */
export const getInviteAutocompleteMenuMaxHeight = (
  anchor: InviteAutocompleteMenuAnchorRect,
  viewportHeight: number,
  placement: InviteAutocompleteMenuPlacement
): number => {
  const sideSpace = placement === 'Bottom' ? viewportHeight - (anchor.y + anchor.height) : anchor.y;

  return Math.max(
    0,
    Math.floor(
      Math.min(
        sideSpace - INVITE_AUTOCOMPLETE_MENU_OFFSET_PX,
        (viewportHeight * INVITE_AUTOCOMPLETE_MENU_MAX_VIEWPORT_PERCENT) / 100,
        INVITE_AUTOCOMPLETE_MENU_MAX_HEIGHT_PX
      )
    )
  );
};
