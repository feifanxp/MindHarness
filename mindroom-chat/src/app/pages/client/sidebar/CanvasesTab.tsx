import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useCanvasesSelected } from '../../../hooks/router/useCanvasesSelected';
import { useAccountData } from '../../../hooks/useAccountData';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useHasListedCanvases } from '../../../mindroom/canvas/canvasIndex';
import { PINNED_CANVASES_TYPE, readPinnedCanvases } from '../../../mindroom/canvas/pinnedCanvases';
import { getCanvasesPath } from '../../pathUtils';

export function CanvasesTab({ onSelect }: { onSelect?: (selected: boolean) => boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = useCanvasesSelected();
  const listed = useHasListedCanvases(useMatrixClient());
  const pinned = readPinnedCanvases(useAccountData(PINNED_CANVASES_TYPE)?.getContent()).length > 0;

  // Shown once there is a canvas to find (a pin may name one this browser has not seen),
  // and while its page is open.
  if (!listed && !pinned && !selected) return null;

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('nav.canvases')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.canvases')}
            onClick={() => {
              onSelect?.(false);
              navigate(getCanvasesPath());
            }}
          >
            <Icon src={Icons.Category} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
