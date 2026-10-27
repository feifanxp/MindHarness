import { StatusBar, Style } from '@capacitor/status-bar';

import { isNativeIOS } from './nativeSso';

export const syncNativeStatusBarTheme = (scheme: 'light' | 'dark'): void => {
  if (!isNativeIOS()) return;

  // MindRoomBridgeViewController leaves the background to the web safe area.
  // Only the native clock and status icons need to follow the active theme.
  StatusBar.setStyle({ style: scheme === 'dark' ? Style.Dark : Style.Light }).catch(
    () => undefined
  );
};
