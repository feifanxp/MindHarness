export enum SettingsPages {
  GeneralPage,
  AccountPage,
  NotificationPage,
  DevicesPage,
  EmojisStickersPage,
  DeveloperToolsPage,
  AboutPage,
}

export type SettingsPage = SettingsPages | string;

export const SIMPLE_MODE_HIDDEN_SETTINGS_PAGES: SettingsPage[] = [
  SettingsPages.DeveloperToolsPage,
  SettingsPages.EmojisStickersPage,
];
