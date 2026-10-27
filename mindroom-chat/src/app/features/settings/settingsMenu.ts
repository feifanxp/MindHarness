import { Icons, IconSrc } from 'folds';
import { type TFunction } from 'i18next';
import { ScreenSize } from '../../hooks/useScreenSize';
import { type SettingsPage, SettingsPages } from './settingsPages';
import {
  getMindroomSettingsMenuItems,
  resolveMindroomSettingsInitialPage,
} from '../../mindroom/settings/settingsMenuExtensions';

export type SettingsMenuItem = {
  page: SettingsPage;
  name: string;
  icon: IconSrc;
};

const getBaseSettingsMenuItems = (showLocalMindRoom: boolean, t: TFunction): SettingsMenuItem[] => [
  {
    page: SettingsPages.GeneralPage,
    name: t('settings.nav.general'),
    icon: Icons.Setting,
  },
  {
    page: SettingsPages.AccountPage,
    name: t('settings.nav.account'),
    icon: Icons.User,
  },
  {
    page: SettingsPages.NotificationPage,
    name: t('settings.nav.notifications'),
    icon: Icons.Bell,
  },
  {
    page: SettingsPages.DevicesPage,
    name: t('settings.nav.devices'),
    icon: Icons.Monitor,
  },
  {
    page: SettingsPages.EmojisStickersPage,
    name: t('settings.nav.emojisStickers'),
    icon: Icons.Smile,
  },
  ...getMindroomSettingsMenuItems(showLocalMindRoom, t),
  {
    page: SettingsPages.DeveloperToolsPage,
    name: t('settings.nav.developerTools'),
    icon: Icons.Terminal,
  },
  {
    page: SettingsPages.AboutPage,
    name: t('settings.nav.about'),
    icon: Icons.Info,
  },
];

export const getSettingsMenuItems = (
  showLocalMindRoom: boolean,
  t: TFunction
): SettingsMenuItem[] => getBaseSettingsMenuItems(showLocalMindRoom, t);

export const resolveSettingsInitialPage = (
  initialPage: SettingsPage | undefined,
  screenSize: ScreenSize,
  showLocalMindRoom: boolean
): SettingsPage | undefined =>
  resolveMindroomSettingsInitialPage(initialPage, screenSize, showLocalMindRoom);
