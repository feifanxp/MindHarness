import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useThreadsSelected } from '../../../hooks/router/useThreadsSelected';
import { getThreadsPath } from '../../pathUtils';

export function ThreadsTab({ onSelect }: { onSelect?: (selected: boolean) => boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = useThreadsSelected();

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('nav.threads')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={() => {
              onSelect?.(false);
              navigate(getThreadsPath());
            }}
          >
            <Icon src={Icons.Thread} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
