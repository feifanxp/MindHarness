// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configClass, varsClass } from 'folds';

const statusBarTheme = vi.hoisted(() => ({
  syncNativeStatusBarTheme: vi.fn(),
}));

vi.mock('../hooks/useTheme', () => {
  const ThemeKind = {
    Light: 'light',
    Dark: 'dark',
  };

  return {
    ThemeKind,
    LightTheme: {
      id: 'light-theme',
      kind: ThemeKind.Light,
      classNames: ['light-class', 'light-font', 'prism-light'],
    },
    SilverTheme: {
      id: 'silver-theme',
      kind: ThemeKind.Light,
      classNames: ['silver-theme', 'silver-class', 'light-font', 'prism-light'],
    },
    DarkTheme: {
      id: 'dark-theme',
      kind: ThemeKind.Dark,
      classNames: ['dark-theme', 'dark-class', 'dark-font', 'prism-dark'],
    },
    MidnightTheme: {
      id: 'midnight-theme',
      kind: ThemeKind.Dark,
      classNames: ['midnight-theme', 'midnight-class', 'dark-font', 'prism-dark'],
    },
    ButterTheme: {
      id: 'butter-theme',
      kind: ThemeKind.Dark,
      classNames: ['butter-theme', 'butter-class', 'dark-font', 'prism-dark'],
    },
  };
});

vi.mock('../mindroom/native/statusBarTheme', () => statusBarTheme);

import { DarkTheme, SilverTheme } from '../hooks/useTheme';
import { SESSION_STORE_KEY } from '../state/sessions';
import { applyThemeToDom, resolveInitialTheme } from './themeBootstrap';

const ACTIVE_SESSION_STORE = {
  version: 1,
  sessions: [{ sessionId: 's1' }],
  activeSessionId: 's1',
};

const setMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const setStoredSettings = (value: unknown) => {
  if (typeof value === 'string') {
    window.localStorage.setItem('settings', value);
    return;
  }

  window.localStorage.setItem('settings', JSON.stringify(value));
};

const setStoredSessionStore = (value: unknown) => {
  if (typeof value === 'string') {
    window.localStorage.setItem(SESSION_STORE_KEY, value);
    return;
  }

  window.localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(value));
};

describe('themeBootstrap', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#1A1A1A" />
      <meta name="color-scheme" content="dark light" />
    `;
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
    document.body.className = '';
    document.body.style.cssText = '';
    window.location.hash = '';
    window.localStorage.clear();
    delete window.__INITIAL_THEME__;
    setMatchMedia(false);
    statusBarTheme.syncNativeStatusBarTheme.mockClear();
  });

  afterEach(() => {
    delete window.__INITIAL_THEME__;
    vi.restoreAllMocks();
  });

  it('defaults to dark-theme when storage is empty and the system theme is dark', () => {
    setMatchMedia(true);

    expect(resolveInitialTheme().themeId).toBe('dark-theme');
  });

  it('defaults to light-theme when storage is empty and the system theme is light', () => {
    expect(resolveInitialTheme().themeId).toBe('light-theme');
  });

  it('falls back without throwing when stored settings JSON is malformed', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings('{bad json');

    expect(resolveInitialTheme().themeId).toBe('dark-theme');
  });

  it('falls back without throwing when stored settings JSON is null', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings('null');

    expect(resolveInitialTheme().themeId).toBe('dark-theme');
  });

  it('uses the explicit theme when useSystemTheme is false', () => {
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'dark-theme',
    });

    expect(resolveInitialTheme().themeId).toBe('dark-theme');
  });

  it('falls back to light-theme when useSystemTheme is false and themeId is missing', () => {
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: false,
    });

    expect(resolveInitialTheme().themeId).toBe('light-theme');
  });

  it('uses darkThemeId when useSystemTheme is true and the system theme is dark', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: true,
      darkThemeId: 'butter-theme',
    });

    expect(resolveInitialTheme().themeId).toBe('butter-theme');
  });

  it('uses lightThemeId when useSystemTheme is true and the system theme is light', () => {
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: true,
      lightThemeId: 'silver-theme',
    });

    expect(resolveInitialTheme().themeId).toBe('silver-theme');
  });

  it('falls back to light-theme when useSystemTheme is false and themeId is invalid', () => {
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'purple-theme',
    });

    expect(resolveInitialTheme().themeId).toBe('light-theme');
  });

  it('falls back to light-theme when useSystemTheme is false and themeId is a prototype key', () => {
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'toString',
    });

    expect(resolveInitialTheme().themeId).toBe('light-theme');
  });

  it('falls back to dark-theme when the stored dark theme id is a prototype key', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: true,
      darkThemeId: 'constructor',
    });

    expect(resolveInitialTheme().themeId).toBe('dark-theme');
  });

  it.each([
    {
      label: 'null',
      useSystemTheme: null,
      themeId: 'silver-theme',
      expectedThemeId: 'silver-theme',
    },
    { label: '0', useSystemTheme: 0, themeId: 'butter-theme', expectedThemeId: 'butter-theme' },
    {
      label: 'empty string',
      useSystemTheme: '',
      themeId: 'dark-theme',
      expectedThemeId: 'dark-theme',
    },
  ])(
    'treats falsey useSystemTheme=$label as explicit theme mode on authenticated launch',
    ({ useSystemTheme, themeId, expectedThemeId }) => {
      setStoredSessionStore(ACTIVE_SESSION_STORE);
      setStoredSettings({
        useSystemTheme,
        themeId,
      });

      expect(resolveInitialTheme('/').themeId).toBe(expectedThemeId);
    }
  );

  it('treats a missing useSystemTheme key as system theme mode even when themeId is present', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      themeId: 'silver-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('dark-theme');
  });

  it('treats an empty stored settings object as system theme mode', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({});

    expect(resolveInitialTheme('/').themeId).toBe('dark-theme');
  });

  it.each([
    { matches: false, expectedThemeId: 'light-theme' },
    { matches: true, expectedThemeId: 'dark-theme' },
  ])(
    'ignores stored custom themes on unauth route cold launch when system dark mode matches=$matches',
    ({ matches, expectedThemeId }) => {
      setMatchMedia(matches);
      setStoredSettings({
        useSystemTheme: false,
        themeId: 'silver-theme',
      });

      expect(resolveInitialTheme('/login/').themeId).toBe(expectedThemeId);
    }
  );

  it('falls back to light-theme on / when there is no stored active session even if an explicit theme is stored', () => {
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'butter-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('light-theme');
  });

  it('falls back to dark-theme on / when the session store exists but has no sessions', () => {
    setMatchMedia(true);
    setStoredSessionStore({
      version: 1,
      sessions: [],
    });
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'silver-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('dark-theme');
  });

  it('uses the stored explicit theme on / when the session store has a matching active session', () => {
    setMatchMedia(true);
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'butter-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('butter-theme');
  });

  it('falls back to light-theme on / when the session store has sessions but no activeSessionId', () => {
    setStoredSessionStore({
      version: 1,
      sessions: [{ sessionId: 's1' }],
    });
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'silver-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('light-theme');
  });

  it('falls back to light-theme on / when the session store activeSessionId does not match a session', () => {
    setStoredSessionStore({
      version: 1,
      sessions: [{ sessionId: 's1' }],
      activeSessionId: 's2',
    });
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'butter-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('light-theme');
  });

  it('falls back to light-theme on / when the session store JSON is malformed', () => {
    setStoredSessionStore('{bad json');
    setStoredSettings({
      useSystemTheme: false,
      themeId: 'silver-theme',
    });

    expect(resolveInitialTheme('/').themeId).toBe('light-theme');
  });

  it.each([{ hash: '#/login' }, { hash: '#/cinny/register' }, { hash: '#/reset-password' }])(
    'ignores stored custom themes on hash-router unauth route $hash',
    ({ hash }) => {
      setStoredSettings({
        useSystemTheme: false,
        themeId: 'silver-theme',
      });

      window.location.hash = hash;
      expect(resolveInitialTheme().themeId).toBe('light-theme');

      setMatchMedia(true);
      expect(resolveInitialTheme().themeId).toBe('dark-theme');
    }
  );

  it.each([
    { pathname: '/', hash: '#/login?addAccount=1' },
    { pathname: '/', hash: '#/login?loginToken=abc' },
    { pathname: '/', hash: '#/register?email=test@example.com' },
    { pathname: '/', hash: '#/reset-password?email=test@example.com' },
    { pathname: '/', hash: '#/cinny/login?addAccount=1' },
    { pathname: '/login?return_to=/foo', hash: '' },
  ])(
    'ignores stored custom themes on query-bearing unauth route pathname=$pathname hash=$hash',
    ({ pathname, hash }) => {
      setStoredSettings({
        useSystemTheme: false,
        themeId: 'silver-theme',
      });

      expect(resolveInitialTheme(pathname, hash).themeId).toBe('light-theme');

      setMatchMedia(true);
      expect(resolveInitialTheme(pathname, hash).themeId).toBe('dark-theme');
    }
  );

  it('uses window.__INITIAL_THEME__ as a fast path before localStorage', () => {
    const getItemSpy = vi.spyOn(Object.getPrototypeOf(window.localStorage), 'getItem');
    setStoredSessionStore(ACTIVE_SESSION_STORE);
    window.__INITIAL_THEME__ = 'silver-theme';

    expect(resolveInitialTheme().themeId).toBe('silver-theme');
    expect(getItemSpy).toHaveBeenCalledWith(SESSION_STORE_KEY);
    expect(getItemSpy).not.toHaveBeenCalledWith('settings');
  });

  it('applies the full class stack, syncs the html theme id, and updates meta/native status bar colors conditionally', () => {
    applyThemeToDom(SilverTheme);

    expect(document.documentElement.classList.contains('silver-theme')).toBe(true);
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#DEDEDE'
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'light'
    );
    expect(statusBarTheme.syncNativeStatusBarTheme).toHaveBeenLastCalledWith('light');

    [configClass, varsClass, ...SilverTheme.classNames].forEach((className) => {
      expect(document.body.classList.contains(className)).toBe(true);
    });

    applyThemeToDom(DarkTheme);

    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(document.documentElement.classList.contains('silver-theme')).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#1A1A1A'
    );
    expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'dark'
    );
    expect(statusBarTheme.syncNativeStatusBarTheme).toHaveBeenLastCalledWith('dark');
  });
});
