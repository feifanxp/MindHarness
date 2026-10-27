import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar, Style } from '@capacitor/status-bar';

import { isNativeIOS } from './nativeSso';
import { syncNativeStatusBarTheme } from './statusBarTheme';

vi.mock('@capacitor/status-bar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/status-bar')>()),
  StatusBar: {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
    setStyle: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./nativeSso', () => ({
  isNativeIOS: vi.fn(),
}));

describe('syncNativeStatusBarTheme', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReset();
    vi.clearAllMocks();
  });

  it.each([
    ['light', Style.Light],
    ['dark', Style.Dark],
  ] as const)(
    'uses %s theme status icons without changing native webview geometry',
    (scheme, style) => {
      vi.mocked(isNativeIOS).mockReturnValue(true);

      syncNativeStatusBarTheme(scheme);

      expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
      expect(StatusBar.setStyle).toHaveBeenCalledWith({ style });
      expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
    }
  );

  it('does nothing outside the native iOS wrapper', () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);

    syncNativeStatusBarTheme('light');

    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
    expect(StatusBar.setStyle).not.toHaveBeenCalled();
    expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
  });
});
