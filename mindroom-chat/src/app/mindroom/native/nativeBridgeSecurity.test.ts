import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const nativeSource = (path: string) =>
  readFileSync(new URL(`../../../../node_modules/@capacitor/${path}`, import.meta.url), 'utf8');

describe('installed native bridge security contract', () => {
  it('rejects subframe plugin and Cordova messages before reading JavaScript data', () => {
    const source = nativeSource('ios/Capacitor/Capacitor/WebViewDelegationHandler.swift');
    expect(source).toMatch(
      /didReceive message: WKScriptMessage\) \{\s*(?:\/\/[^\n]*\n\s*)*guard message\.frameInfo\.isMainFrame else \{ return \}\s*guard let bridge/
    );
  });

  it('rejects the synchronous cookie and HTTP prompt bridge in subframes', () => {
    const source = nativeSource('ios/Capacitor/Capacitor/WebViewDelegationHandler.swift');
    expect(source).toMatch(
      /completionHandler: @escaping \(String\?\) -> Void\) \{\s*(?:\/\/[^\n]*\n\s*)*guard frame\.isMainFrame else \{\s*completionHandler\(nil\)\s*return\s*\}/
    );
  });

  it('injects every iOS bridge script only into the main frame', () => {
    const scripts = [
      ...nativeSource('ios/Capacitor/Capacitor/JSExport.swift').matchAll(/WKUserScript\([^\n]+/g),
    ];
    expect(scripts.length).toBeGreaterThan(0);
    scripts.forEach(([script]) => expect(script).toContain('forMainFrameOnly: true'));
  });

  it('does not fall back to Android interfaces that cannot identify their caller frame', () => {
    const source = nativeSource(
      'android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java'
    );
    expect(source).toContain('if (isMainFrame)');
    expect(source).not.toContain('addJavascriptInterface');
    const activity = readFileSync(
      new URL(
        '../../../../android/app/src/main/java/com/mindroom_ai/app/MainActivity.java',
        import.meta.url
      ),
      'utf8'
    );
    ['CapacitorCookies', 'CapacitorHttp', 'SystemBars'].forEach((plugin) => {
      expect(
        nativeSource(`android/capacitor/src/main/java/com/getcapacitor/plugin/${plugin}.java`)
      ).not.toContain('addJavascriptInterface');
    });
    expect(activity).toContain('onPageCommitVisible');
    expect(activity).toContain('((SystemBars) plugin.getInstance()).onDOMReady()');
  });
});
