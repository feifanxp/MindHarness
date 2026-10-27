import React, { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { isKeyHotkey } from 'is-hotkey';
import { config } from 'folds';
import { PageScroll } from '../../page';
import { Menu, Header } from '../../glass/GlassPrimitives';

import * as css from './AutocompleteMenu.css';
import { preventScrollWithArrowKey, stopPropagation } from '../../../utils/keyboard';
import { useAlive } from '../../../hooks/useAlive';

type AutocompleteMenuProps = {
  requestClose: () => void;
  headerContent: ReactNode;
  children: ReactNode;
};
export function AutocompleteMenu({ headerContent, requestClose, children }: AutocompleteMenuProps) {
  const alive = useAlive();

  const handleDeactivate = () => {
    if (alive()) {
      // The component is unmounted so we will not call for `requestClose`
      requestClose();
    }
  };

  return (
    <div className={css.AutocompleteMenuBase}>
      <div className={css.AutocompleteMenuContainer}>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onPostDeactivate: handleDeactivate,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: true,
            allowOutsideClick: true,
            isKeyForward: (evt: KeyboardEvent) => isKeyHotkey('arrowdown', evt),
            isKeyBackward: (evt: KeyboardEvent) => isKeyHotkey('arrowup', evt),
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu className={css.AutocompleteMenu}>
            <PageScroll
              header={
                <Header className={css.AutocompleteMenuHeader} size="400">
                  {headerContent}
                </Header>
              }
              onKeyDown={preventScrollWithArrowKey}
              scrollbarTabIndex={-1}
            >
              <div style={{ padding: config.space.S200 }}>{children}</div>
            </PageScroll>
          </Menu>
        </FocusTrap>
      </div>
    </div>
  );
}
