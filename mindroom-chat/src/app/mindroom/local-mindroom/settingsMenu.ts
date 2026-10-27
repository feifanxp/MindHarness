import { Icons, type IconSrc } from 'folds';
import { LOCAL_MINDROOM_SETTINGS_PAGE, type LocalMindroomSettingsPage } from './settingsPage';

export type LocalMindroomSettingsMenuItem = {
  page: LocalMindroomSettingsPage;
  name: string;
  icon: IconSrc;
};

export const getLocalMindroomSettingsMenuItem = (): LocalMindroomSettingsMenuItem => ({
  page: LOCAL_MINDROOM_SETTINGS_PAGE,
  // This names the paired local runtime, not the MindRoom Chat client.
  name: 'Local MindRoom',
  icon: Icons.Link,
});

export const getLocalMindroomSettingsMenuItems = (
  enabled: boolean
): LocalMindroomSettingsMenuItem[] => (enabled ? [getLocalMindroomSettingsMenuItem()] : []);
