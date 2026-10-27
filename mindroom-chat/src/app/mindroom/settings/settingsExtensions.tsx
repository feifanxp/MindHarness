import React from 'react';
import { ArchivedRooms, ARCHIVED_ROOMS_SETTINGS_PAGE } from '../rooms/ArchivedRoomsPage';
import { type SettingsPage } from '../../features/settings/settingsPages';
import { renderLocalMindroomSettingsPage } from '../local-mindroom/settingsRenderer';
import { MindroomPrefetchSettings } from './MindroomPrefetchSettings';

import { MindroomInterfaceSettings as InterfaceSettings } from './MindroomInterfaceSettings';
import { MindroomComputerSettings } from './MindroomComputerSettings';
import { MindroomConnectionsSettings } from './MindroomConnectionsSettings';

export function MindroomInterfaceSettings({ className }: { className?: string }) {
  return (
    <>
      <InterfaceSettings className={className} />
      <MindroomComputerSettings className={className} />
      <MindroomConnectionsSettings className={className} />
    </>
  );
}

type MindroomGeneralMessageSettingsProps = {
  className?: string;
};

export const renderMindroomSettingsPage = (
  activePage: SettingsPage | undefined,
  enabled: boolean,
  requestClose: () => void,
  onNavigate: () => void
): React.ReactNode =>
  activePage === ARCHIVED_ROOMS_SETTINGS_PAGE ? (
    <ArchivedRooms requestClose={requestClose} onNavigate={onNavigate} />
  ) : (
    renderLocalMindroomSettingsPage(activePage, enabled, requestClose, onNavigate)
  );

export function MindroomGeneralMessageSettings({ className }: MindroomGeneralMessageSettingsProps) {
  return <MindroomPrefetchSettings className={className} />;
}
