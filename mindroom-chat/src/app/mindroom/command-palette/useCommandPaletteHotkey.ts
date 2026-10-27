import { useCallback } from 'react';
import { useKeyDown } from '../../hooks/useKeyDown';
import { hasBlockingPortalOverlay } from '../../utils/portalOverlay';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../computer/computerFocus';

export const useCommandPaletteHotkey = (
  opened: boolean,
  setOpen: (nextOpen: boolean) => void,
  matchesShortcut: (event: KeyboardEvent) => boolean
) => {
  useKeyDown(
    window,
    useCallback(
      (event) => {
        if (!matchesShortcut(event)) return;
        if (computerOwnsKeyboardEvent(event) || computerOwnsKeyboardFocus()) return;
        if (!opened && hasBlockingPortalOverlay()) {
          return;
        }

        event.preventDefault();
        setOpen(!opened);
      },
      [matchesShortcut, opened, setOpen]
    )
  );
};
