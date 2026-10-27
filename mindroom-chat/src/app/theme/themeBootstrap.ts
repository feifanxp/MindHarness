import { configClass, varsClass } from 'folds';
import {
  ButterTheme,
  DarkTheme,
  LightTheme,
  MidnightTheme,
  SilverTheme,
  type Theme,
  ThemeKind,
} from '../hooks/useTheme';
import { MINDROOM_SESSION_STORE_KEY } from '../mindroom/cache/sessionStoreConfig';
import { syncNativeStatusBarTheme } from '../mindroom/native/statusBarTheme';
import { getSettings } from '../state/settings';

const UNAUTH_ROUTE_PATH_PATTERN = /(?:^|\/)(login|register|reset-password)(?:\/[^/]+)?\/?$/;
const hasOwn = Object.prototype.hasOwnProperty;

const THEME_IDS = [
  LightTheme.id,
  SilverTheme.id,
  DarkTheme.id,
  MidnightTheme.id,
  ButterTheme.id,
] as const;
type ThemeId = typeof THEME_IDS[number];
type ThemeScheme = 'light' | 'dark';

type ThemeLike = Pick<Theme, 'id' | 'kind' | 'classNames'>;

export type ResolvedTheme = {
  themeId: ThemeId;
  themeKind: ThemeKind;
  bgColor: string;
  scheme: ThemeScheme;
  classNames: string[];
};

declare global {
  interface Window {
    __INITIAL_THEME__?: string;
  }
}

const RESOLVED_THEME_MAP: Record<ThemeId, ResolvedTheme> = {
  [LightTheme.id]: {
    themeId: LightTheme.id,
    themeKind: LightTheme.kind,
    bgColor: '#F2F2F2',
    scheme: 'light',
    classNames: [configClass, varsClass, ...LightTheme.classNames],
  },
  [SilverTheme.id]: {
    themeId: SilverTheme.id,
    themeKind: SilverTheme.kind,
    bgColor: '#DEDEDE',
    scheme: 'light',
    classNames: [configClass, varsClass, ...SilverTheme.classNames],
  },
  [DarkTheme.id]: {
    themeId: DarkTheme.id,
    themeKind: DarkTheme.kind,
    bgColor: '#1A1A1A',
    scheme: 'dark',
    classNames: [configClass, varsClass, ...DarkTheme.classNames],
  },
  [MidnightTheme.id]: {
    themeId: MidnightTheme.id,
    themeKind: MidnightTheme.kind,
    bgColor: '#17161D',
    scheme: 'dark',
    classNames: [configClass, varsClass, ...MidnightTheme.classNames],
  },
  [ButterTheme.id]: {
    themeId: ButterTheme.id,
    themeKind: ButterTheme.kind,
    bgColor: '#1A1916',
    scheme: 'dark',
    classNames: [configClass, varsClass, ...ButterTheme.classNames],
  },
};

const isThemeId = (themeId: string | undefined): themeId is ThemeId =>
  typeof themeId === 'string' && hasOwn.call(RESOLVED_THEME_MAP, themeId);

const resolveThemeId = (themeId: string | undefined, fallbackThemeId: ThemeId): ThemeId =>
  isThemeId(themeId) ? themeId : fallbackThemeId;

// CINNY-087: keep in sync with the inline bootstrap in index.html.
const stripSearchAndHash = (raw: string | undefined): string => {
  if (typeof raw !== 'string') return '';

  let normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex);
  }

  return normalized;
};

const pathLooksLikeUnauthRoute = (path: string | undefined): boolean =>
  typeof path === 'string' && UNAUTH_ROUTE_PATH_PATTERN.test(path);

const isUnauthRouteUrl = (pathname: string | undefined, hash: string | undefined): boolean =>
  pathLooksLikeUnauthRoute(stripSearchAndHash(pathname)) ||
  pathLooksLikeUnauthRoute(stripSearchAndHash(hash));

const prefersDarkMode = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

// CINNY-087: keep in sync with the inline bootstrap in index.html.
const hasActiveStoredSession = (): boolean => {
  try {
    if (
      typeof window === 'undefined' ||
      !window.localStorage ||
      typeof window.localStorage.getItem !== 'function'
    ) {
      return false;
    }

    const rawSessionStore = window.localStorage.getItem(MINDROOM_SESSION_STORE_KEY);
    if (!rawSessionStore) return false;

    const parsed = JSON.parse(rawSessionStore) as {
      sessions?: Array<{ sessionId?: unknown }>;
      activeSessionId?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') return false;

    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    if (sessions.length === 0) return false;

    const activeSessionId =
      typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : undefined;
    if (!activeSessionId) return false;

    return sessions.some((session) => session && session.sessionId === activeSessionId);
  } catch {
    return false;
  }
};

const resolveStoredThemeSettings = (): ResolvedTheme => {
  const settings = getSettings();

  if (!settings.useSystemTheme) {
    return RESOLVED_THEME_MAP[resolveThemeId(settings.themeId, LightTheme.id)];
  }

  if (prefersDarkMode()) {
    return RESOLVED_THEME_MAP[resolveThemeId(settings.darkThemeId, DarkTheme.id)];
  }

  return RESOLVED_THEME_MAP[resolveThemeId(settings.lightThemeId, LightTheme.id)];
};

const resolveTheme = (theme: ThemeLike | ResolvedTheme): ResolvedTheme =>
  'themeId' in theme
    ? RESOLVED_THEME_MAP[theme.themeId]
    : RESOLVED_THEME_MAP[resolveThemeId(theme.id, DarkTheme.id)];

const setMetaContent = (name: string, content: string): void => {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (meta && meta.content !== content) {
    meta.content = content;
  }
};

export const resolveInitialTheme = (
  pathname = typeof window !== 'undefined' ? window.location.pathname : undefined,
  hash = typeof window !== 'undefined' ? window.location.hash : undefined
): ResolvedTheme => {
  if (isUnauthRouteUrl(pathname, hash) || !hasActiveStoredSession()) {
    return prefersDarkMode() ? RESOLVED_THEME_MAP[DarkTheme.id] : RESOLVED_THEME_MAP[LightTheme.id];
  }

  if (typeof window !== 'undefined' && isThemeId(window.__INITIAL_THEME__)) {
    return RESOLVED_THEME_MAP[window.__INITIAL_THEME__];
  }

  return resolveStoredThemeSettings();
};

export const applyThemeToDom = (theme: ThemeLike | ResolvedTheme): void => {
  if (typeof document === 'undefined') return;

  const resolvedTheme = resolveTheme(theme);
  const html = document.documentElement;
  const body = document.body;

  if (!html || !body) return;

  body.className = '';
  body.classList.add(...resolvedTheme.classNames);

  html.classList.remove(...THEME_IDS);
  html.classList.add(resolvedTheme.themeId);
  html.style.setProperty('--app-bg-color', resolvedTheme.bgColor);
  html.style.backgroundColor = resolvedTheme.bgColor;
  body.style.backgroundColor = resolvedTheme.bgColor;

  setMetaContent('theme-color', resolvedTheme.bgColor);
  setMetaContent('color-scheme', resolvedTheme.scheme);
  syncNativeStatusBarTheme(resolvedTheme.scheme);
};
