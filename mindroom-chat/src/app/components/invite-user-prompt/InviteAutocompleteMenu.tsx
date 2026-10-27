import React, { ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import { PopOut, config, type RectCords } from 'folds';
import { PageScroll } from '../page';
import { Menu, Header } from '../glass/GlassPrimitives';
import { glassDenseOverBackdrop } from '../../styles/Glass.css';

import { useAlive } from '../../hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../utils/keyboard';
import {
  INVITE_AUTOCOMPLETE_MENU_OFFSET_PX,
  getInviteAutocompleteMenuMaxHeight,
  getInviteAutocompleteMenuPlacement,
  type InviteAutocompleteMenuPlacement,
} from './inviteAutocompleteMenuPlacement';
import * as css from './InviteAutocompleteMenu.css';

const isSameRect = (left: RectCords | undefined, right: RectCords): boolean =>
  !!left &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

type InviteAutocompleteMenuProps = {
  open: boolean;
  requestClose: () => void;
  input: ReactNode;
  headerContent: ReactNode;
  menuId: string;
  menuLabel: string;
  children: ReactNode;
};

export function InviteAutocompleteMenu({
  open,
  requestClose,
  input,
  headerContent,
  menuId,
  menuLabel,
  children,
}: InviteAutocompleteMenuProps) {
  const alive = useAlive();
  const openRef = useRef(open);
  const requestCloseRef = useRef(requestClose);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<RectCords>();
  const [placement, setPlacement] = useState<InviteAutocompleteMenuPlacement>('Bottom');
  const [maxHeight, setMaxHeight] = useState<number>();

  openRef.current = open;
  // FocusTrap stores callbacks; keep deactivation wired to the latest parent closure.
  requestCloseRef.current = requestClose;

  const handleDeactivate = useCallback(() => {
    if (alive() && openRef.current) {
      requestCloseRef.current();
    }
  }, [alive]);

  // The menu portals outside the trap's DOM subtree; clicks inside it are
  // part of the combobox and must not deactivate the trap.
  const handleClickOutsideDeactivates = useCallback((event: MouseEvent | TouchEvent): boolean => {
    const menuElement = menuRef.current;
    const target = event.target as Node | null;
    return !(menuElement && target && menuElement.contains(target));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(undefined);
      return undefined;
    }

    const updateAnchor = () => {
      const anchorElement = anchorRef.current;
      if (!anchorElement) return;
      const anchorRect = anchorElement.getBoundingClientRect();
      // Capture-phase scrolls include the menu's own list; skip re-renders
      // while the input has not actually moved.
      setAnchor((previousRect) =>
        isSameRect(previousRect, anchorRect) ? previousRect : anchorRect
      );
      const viewportHeight = document.documentElement.clientHeight;
      const nextPlacement = getInviteAutocompleteMenuPlacement(anchorRect, viewportHeight);
      setPlacement(nextPlacement);
      setMaxHeight(getInviteAutocompleteMenuMaxHeight(anchorRect, viewportHeight, nextPlacement));
    };

    updateAnchor();
    // Capture-phase scroll hears scrolling ancestors (drawer, dialog, lobby).
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('resize', updateAnchor);
    return () => {
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('resize', updateAnchor);
    };
  }, [open]);

  return (
    <FocusTrap
      active={open}
      focusTrapOptions={{
        initialFocus: false,
        onPostDeactivate: handleDeactivate,
        returnFocusOnDeactivate: false,
        clickOutsideDeactivates: handleClickOutsideDeactivates,
        allowOutsideClick: true,
        isKeyForward: () => false,
        isKeyBackward: () => false,
        escapeDeactivates: stopPropagation,
      }}
    >
      <div ref={anchorRef} className={css.InviteAutocompleteMenuRoot}>
        {input}
        <PopOut
          anchor={open ? anchor : undefined}
          position={placement}
          align="Start"
          offset={INVITE_AUTOCOMPLETE_MENU_OFFSET_PX}
          className={css.InviteAutocompletePopOut}
          content={
            <div
              ref={menuRef}
              className={css.InviteAutocompleteMenuContainer}
              style={{ width: anchor?.width }}
            >
              <Menu
                id={menuId}
                role="listbox"
                aria-label={menuLabel}
                // The rows sit over the dialog's own controls; a light tint lets its Invite
                // button show through as if a row were highlighted.
                className={classNames(css.InviteAutocompleteMenu, glassDenseOverBackdrop)}
                style={{ maxHeight }}
              >
                <PageScroll
                  header={
                    <Header className={css.InviteAutocompleteMenuHeader} size="400">
                      {headerContent}
                    </Header>
                  }
                  onKeyDown={preventScrollWithArrowKey}
                  scrollbarTabIndex={-1}
                >
                  <div style={{ padding: config.space.S200 }}>{children}</div>
                </PageScroll>
              </Menu>
            </div>
          }
        />
      </div>
    </FocusTrap>
  );
}
