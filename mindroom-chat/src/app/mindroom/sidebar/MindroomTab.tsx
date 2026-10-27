import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { Icon, Icons } from 'folds';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../components/sidebar';
import MindRoomLogo from '../../../../public/res/branding/mindroom-logo.png';
import { Modal500 } from '../../components/Modal500';
import { Settings } from '../../features/settings';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from '../local-mindroom/settingsPage';
import * as css from './MindroomTab.css';

export function MindroomTab() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);

  return (
    <>
      <SidebarItem active={settings}>
        <SidebarItemTooltip tooltip={t('mindroomUi.sidebar.mindroomTab.localMindroom')}>
          {(triggerRef) => (
            <SidebarAvatar as="button" ref={triggerRef} outlined onClick={() => setSettings(true)}>
              <img
                src={MindRoomLogo}
                alt="MindRoom"
                width={36}
                height={36}
                style={{ objectFit: 'contain' }}
              />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
        <SidebarItemBadge hasCount>
          <span className={css.LinkIndicator}>
            <Icon size="100" src={Icons.Link} />
          </span>
        </SidebarItemBadge>
      </SidebarItem>
      {settings && (
        <Modal500 requestClose={() => setSettings(false)}>
          <Settings
            initialPage={LOCAL_MINDROOM_SETTINGS_PAGE}
            requestClose={() => setSettings(false)}
          />
        </Modal500>
      )}
    </>
  );
}
