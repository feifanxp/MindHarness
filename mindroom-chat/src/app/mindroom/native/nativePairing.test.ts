// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browser } from '@capacitor/browser';
import { registerNativeAppUrlCallbacks } from './nativeSso';

vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn() } }));

describe('native pairing links', () => {
  let openUrl: (event: { url?: string }) => void;
  let warn: ReturnType<typeof vi.spyOn>;

  const register = async (launchUrl?: string) => {
    registerNativeAppUrlCallbacks({
      getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : undefined),
      addListener: async (_name, listener) => {
        openUrl = listener;
      },
    });
    await Promise.resolve();
  };

  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('routes a cold launch to approval within the existing app origin', async () => {
    const origin = window.location.origin;
    await register('https://chat.mindroom.chat/connect?code=ABCD-EFGH');
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname + window.location.search).toBe('/connect?code=ABCD-EFGH');
    expect(Browser.close).not.toHaveBeenCalled();
  });

  it('routes successive warm links and notifies the mounted SPA router', async () => {
    await register();
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    try {
      openUrl({ url: 'https://chat.mindroom.chat/connect?code=ABCD-EFGH' });
      openUrl({ url: 'https://chat.mindroom.chat/connect/?code=JKLM-NPQR' });
      expect(window.location.pathname + window.location.search).toBe('/connect?code=JKLM-NPQR');
      expect(onPopState).toHaveBeenCalledTimes(2);
      expect(Browser.close).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', onPopState);
    }
  });

  it.each([
    ['https://chat.mindroom.chat/connect?code=JKLM-NPQR', '/connect?code=JKLM-NPQR'],
    ['https://other.example/connect?code=JKLM-NPQR', '/connect?code=ABCD-EFGH'],
  ])(
    'keeps the newest accepted URL when launch resolves after %s',
    async (warmUrl, expectedPath) => {
      let resolveLaunch!: (event: { url: string }) => void;
      registerNativeAppUrlCallbacks({
        getLaunchUrl: () =>
          new Promise((resolve) => {
            resolveLaunch = resolve;
          }),
        addListener: async (_name, listener) => {
          openUrl = listener;
        },
      });

      openUrl({ url: warmUrl });
      resolveLaunch({ url: 'https://chat.mindroom.chat/connect?code=ABCD-EFGH' });
      await Promise.resolve();

      expect(window.location.pathname + window.location.search).toBe(expectedPath);
    }
  );

  it('forwards only the pairing code, leaving validation and missing-code input to ConnectPage', async () => {
    await register();
    openUrl({
      url: 'https://chat.mindroom.chat/connect?code=abcd%20efgh&redirect=https://example.com#other',
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/connect?code=abcd+efgh'
    );
    openUrl({ url: 'https://chat.mindroom.chat/connect' });
    expect(window.location.pathname + window.location.search).toBe('/connect');
  });

  it.each([
    'not a URL',
    'http://chat.mindroom.chat/connect?code=SECRET',
    'https://other.example/connect?code=SECRET',
    'https://chat.mindroom.chat.example/connect?code=SECRET',
    'https://chat.mindroom.chat:8443/connect?code=SECRET',
    'https://user:password@chat.mindroom.chat/connect?code=SECRET',
    'https://chat.mindroom.chat/rooms?code=SECRET',
    'https://chat.mindroom.chat/connect/child?code=SECRET',
    'https://chat.mindroom.chat/CONNECT?code=SECRET',
    'mindroom://connect?code=SECRET',
  ])('ignores and logs unsupported URLs without their contents: %s', async (url) => {
    await register();
    openUrl({ url });
    expect(window.location.pathname).toBe('/home');
    expect(warn).toHaveBeenCalledWith('[MindRoom Chat] Ignored unsupported app URL');
    expect(Browser.close).not.toHaveBeenCalled();
  });
});
