import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  onDarkFontWeight,
  onLightFontWeight,
  opticalTracking,
  roundedRadii,
  softShadow,
} from '../../config.css';
import { butterTheme, darkTheme, lightTheme, midnightTheme, silverTheme } from '../../colors.css';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';

export enum ThemeKind {
  Light = 'light',
  Dark = 'dark',
}

export type Theme = {
  id: string;
  kind: ThemeKind;
  classNames: string[];
};

export const LightTheme: Theme = {
  id: 'light-theme',
  kind: ThemeKind.Light,
  classNames: [
    lightTheme,
    onLightFontWeight,
    opticalTracking,
    roundedRadii,
    softShadow,
    'prism-light',
  ],
};

export const SilverTheme: Theme = {
  id: 'silver-theme',
  kind: ThemeKind.Light,
  classNames: [
    'silver-theme',
    silverTheme,
    onLightFontWeight,
    opticalTracking,
    roundedRadii,
    softShadow,
    'prism-light',
  ],
};
export const DarkTheme: Theme = {
  id: 'dark-theme',
  kind: ThemeKind.Dark,
  classNames: [
    'dark-theme',
    darkTheme,
    onDarkFontWeight,
    opticalTracking,
    roundedRadii,
    softShadow,
    'prism-dark',
  ],
};
export const MidnightTheme: Theme = {
  id: 'midnight-theme',
  kind: ThemeKind.Dark,
  classNames: [
    'midnight-theme',
    midnightTheme,
    onDarkFontWeight,
    opticalTracking,
    roundedRadii,
    softShadow,
    'prism-dark',
  ],
};
export const ButterTheme: Theme = {
  id: 'butter-theme',
  kind: ThemeKind.Dark,
  classNames: [
    'butter-theme',
    butterTheme,
    onDarkFontWeight,
    opticalTracking,
    roundedRadii,
    softShadow,
    'prism-dark',
  ],
};

export const useThemes = (): Theme[] => {
  const themes: Theme[] = useMemo(
    () => [LightTheme, SilverTheme, DarkTheme, MidnightTheme, ButterTheme],
    []
  );

  return themes;
};

export const useThemeNames = (): Record<string, string> => {
  const { t } = useTranslation();

  return useMemo(
    () => ({
      [LightTheme.id]: t('options.themeName.light'),
      [SilverTheme.id]: t('options.themeName.silver'),
      [DarkTheme.id]: t('options.themeName.dark'),
      [MidnightTheme.id]: t('options.themeName.midnight'),
      [ButterTheme.id]: t('options.themeName.butter'),
    }),
    [t]
  );
};

export const useSystemThemeKind = (): ThemeKind => {
  const darkModeQueryList = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [themeKind, setThemeKind] = useState<ThemeKind>(
    darkModeQueryList.matches ? ThemeKind.Dark : ThemeKind.Light
  );

  useEffect(() => {
    const handleMediaQueryChange = () => {
      setThemeKind(darkModeQueryList.matches ? ThemeKind.Dark : ThemeKind.Light);
    };

    darkModeQueryList.addEventListener('change', handleMediaQueryChange);
    return () => {
      darkModeQueryList.removeEventListener('change', handleMediaQueryChange);
    };
  }, [darkModeQueryList, setThemeKind]);

  return themeKind;
};

export const useActiveTheme = (): Theme => {
  const systemThemeKind = useSystemThemeKind();
  const themes = useThemes();
  const [systemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId] = useSetting(settingsAtom, 'themeId');
  const [lightThemeId] = useSetting(settingsAtom, 'lightThemeId');
  const [darkThemeId] = useSetting(settingsAtom, 'darkThemeId');

  if (!systemTheme) {
    const selectedTheme = themes.find((theme) => theme.id === themeId) ?? LightTheme;

    return selectedTheme;
  }

  const selectedTheme =
    systemThemeKind === ThemeKind.Dark
      ? themes.find((theme) => theme.id === darkThemeId) ?? DarkTheme
      : themes.find((theme) => theme.id === lightThemeId) ?? LightTheme;

  return selectedTheme;
};

const ThemeContext = createContext<Theme | null>(null);
export const ThemeContextProvider = ThemeContext.Provider;

export const useTheme = (): Theme => {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('No theme provided!');
  }

  return theme;
};
