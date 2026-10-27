import { SettingsPages, type SettingsPage } from '../../features/settings/settingsPages';

export const LOCAL_MINDROOM_SETTINGS_PAGE = 'mindroom.local-mindroom' as const;

export type LocalMindroomSettingsPage = typeof LOCAL_MINDROOM_SETTINGS_PAGE;

export const isLocalMindroomSettingsPage = (
  page: SettingsPage | undefined
): page is LocalMindroomSettingsPage => page === LOCAL_MINDROOM_SETTINGS_PAGE;

export const resolveLocalMindroomInitialSettingsPage = (
  initialPage: SettingsPage | undefined,
  enabled: boolean
): SettingsPage | undefined => {
  if (!enabled && isLocalMindroomSettingsPage(initialPage)) {
    return SettingsPages.GeneralPage;
  }

  return initialPage;
};
