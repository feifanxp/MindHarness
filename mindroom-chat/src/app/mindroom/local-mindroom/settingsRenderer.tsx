import React from 'react';
import { type SettingsPage } from '../../features/settings/settingsPages';
import { LocalMindroom } from './LocalMindroom';
import { isLocalMindroomSettingsPage } from './settingsPage';

export const renderLocalMindroomSettingsPage = (
  activePage: SettingsPage | undefined,
  enabled: boolean,
  requestClose: () => void,
  onNavigate: () => void
): React.ReactNode => {
  if (!enabled || !isLocalMindroomSettingsPage(activePage)) return null;

  return <LocalMindroom requestClose={requestClose} onNavigate={onNavigate} />;
};
