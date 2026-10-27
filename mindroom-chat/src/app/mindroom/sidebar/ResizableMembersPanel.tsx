import React, { ReactNode } from 'react';
import { Overlay, OverlayBackdrop } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ResizablePanel } from './ResizablePanel';
import * as css from './ResizableMembersPanel.css';

export function ResizableMembersPanel({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const panel = (
    <ResizablePanel
      side="end"
      storageKey={`mindroom.members.width:${userId}`}
      defaultWidth={266}
      minContentWidth={mobile ? 0 : 200}
      resizeLabel={t('mindroomUi.sidebar.resizeMemberPanel')}
      collapseLabel={t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')}
      onCollapse={onClose}
      testId="resizable-members-panel"
    >
      {children}
    </ResizablePanel>
  );

  if (!mobile) return panel;

  return (
    <Overlay open backdrop={<OverlayBackdrop onClick={onClose} />}>
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          escapeDeactivates: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return false;
          },
        }}
      >
        <div
          className={css.MobileOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.members')}
        >
          {panel}
        </div>
      </FocusTrap>
    </Overlay>
  );
}
