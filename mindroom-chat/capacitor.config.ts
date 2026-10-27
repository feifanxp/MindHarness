import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'chat.mindroom.app',
  appName: 'MindRoom Chat',
  webDir: 'dist',
  server: {
    // Allow connecting to local homeserver over HTTP
    cleartext: true,
    // Allow mixed content (HTTPS app talking to HTTP homeserver)
    androidScheme: 'https',
    // No iosScheme: WKWebView refuses handlers for schemes it serves natively
    // (http/https), so Capacitor silently falls back to capacitor://localhost.
    // The app's storage (sessions, crypto store) is keyed to that origin — if a
    // future Capacitor honored an https override, the origin change would wipe
    // logins and E2EE state on every installed device.
  },
  ios: {
    // Let the web app own safe-area rendering instead of leaving native gutters
    // around the WKWebView that can drift from the active app theme.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    // Allow arbitrary loads for local network homeservers
    allowsLinkPreview: true,
  },
  plugins: {
    Keyboard: {
      // Use native WebView resizing on iOS so the composer stays above the keyboard
      // (including the predictive/autocorrect suggestion bar) on real devices.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      // Android keeps native insets. MindRoomBridgeViewController overrides this
      // to true on iOS, where viewport-fit=cover and CSS own the safe area.
      overlaysWebView: false,
      // Background for platforms that retain a separate native status bar.
      backgroundColor: '#1A1A1A',
      style: 'dark',
    },
  },
};

export default config;
