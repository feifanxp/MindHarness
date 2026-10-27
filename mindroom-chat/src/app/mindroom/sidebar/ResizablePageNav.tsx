import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MobileFriendlyPageNav } from '../../pages/MobileFriendly';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMindroomDesktopPageNav } from './desktopPageNavState';
import { ResizablePanel } from './ResizablePanel';

export function ResizablePageNav({
  children,
  onCollapse,
}: {
  children: ReactNode;
  onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  return (
    <ResizablePanel
      storageKey={`mindroom.pageNav.width:${userId}`}
      fullWidth={mobile}
      resizeLabel={t('mindroomUi.sidebar.resizeNavigationPanel')}
      collapseLabel={t('sharedUi.mindroomNavigation.collapseNavigationPanel')}
      onCollapse={onCollapse}
      testId="resizable-page-nav"
    >
      {children}
    </ResizablePanel>
  );
}

export function MindroomPageNav({ path, children }: { path: string; children: ReactNode }) {
  const { canCollapse, setCollapsed } = useMindroomDesktopPageNav();
  return (
    <MobileFriendlyPageNav path={path}>
      <ResizablePageNav onCollapse={canCollapse ? () => setCollapsed(true) : undefined}>
        {children}
      </ResizablePageNav>
    </MobileFriendlyPageNav>
  );
}
