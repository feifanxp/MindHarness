import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

const APP_HEIGHT = '--app-height';
const APP_VIEWPORT_OFFSET_TOP = '--app-viewport-offset-top';
// iOS 26 can leave visualViewport 24px shorter after keyboard dismissal.
const MIN_KEYBOARD_VIEWPORT_REDUCTION = 48;
const SETTLE_DELAY_MS = 80;

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const isTextEditor = (element: Element | null | undefined): boolean => {
  if (!element) return false;

  const nodeName = element.nodeName.toUpperCase();
  if (nodeName === 'TEXTAREA') return true;
  if (nodeName === 'INPUT') {
    const inputType = element.getAttribute('type')?.toLowerCase() ?? 'text';
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }

  const contentEditable = element.getAttribute('contenteditable')?.toLowerCase();
  return (
    contentEditable === '' ||
    contentEditable === 'true' ||
    contentEditable === 'plaintext-only' ||
    (element as HTMLElement).isContentEditable === true
  );
};

const positiveFinite = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * Some mobile browsers keep the layout viewport full-height while the software
 * keyboard shrinks and pans only the visual viewport.
 *
 * Detect that geometry directly instead of guessing from the browser name.
 * Browsers honoring `interactive-widget=resizes-content` naturally no-op
 * because their layout and visual viewports remain equal.
 *
 * The CSS consumer keeps `#root` in normal flow and applies these values as
 * height plus top margin, avoiding a new fixed-position containing block.
 */
export function useMobileKeyboardViewportFix(): void {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return undefined;

    const nativePlatform = Capacitor.isNativePlatform();
    const keyboardHandles: PluginListenerHandle[] = [];
    let animationFrameId: number | undefined;
    let settleTimeoutId: number | undefined;
    let keyboardGeometryActive = false;
    let nativeLayoutHeightForced = false;
    let retainWithoutFocusForQueuedFrame = false;
    let disposed = false;

    const clearGeometry = () => {
      keyboardGeometryActive = false;
      document.documentElement.style.removeProperty(APP_HEIGHT);
      document.documentElement.style.removeProperty(APP_VIEWPORT_OFFSET_TOP);
    };

    const syncGeometry = (retainWithoutFocus: boolean) => {
      if (disposed) return;

      const viewportHeight = positiveFinite(window.visualViewport?.height);
      const innerHeight = positiveFinite(window.innerHeight);
      const clientHeight = positiveFinite(document.documentElement.clientHeight);
      const layoutHeight =
        innerHeight !== undefined && clientHeight !== undefined
          ? Math.max(innerHeight, clientHeight)
          : innerHeight ?? clientHeight;

      if (nativeLayoutHeightForced) {
        keyboardGeometryActive = false;
        if (layoutHeight !== undefined) {
          document.documentElement.style.setProperty(APP_HEIGHT, `${layoutHeight}px`);
          document.documentElement.style.setProperty(APP_VIEWPORT_OFFSET_TOP, '0px');
        }
        return;
      }

      const scale = window.visualViewport?.scale ?? 1;
      const unzoomed = Number.isFinite(scale) && Math.abs(scale - 1) < 0.01;
      const editorFocused = isTextEditor(document.activeElement);
      const layoutStillFullHeight =
        viewportHeight !== undefined &&
        layoutHeight !== undefined &&
        viewportHeight <= layoutHeight - MIN_KEYBOARD_VIEWPORT_REDUCTION;

      if (
        !unzoomed ||
        !layoutStillFullHeight ||
        (!editorFocused && (!keyboardGeometryActive || !retainWithoutFocus)) ||
        viewportHeight === undefined
      ) {
        clearGeometry();
        return;
      }

      const rawOffsetTop = window.visualViewport?.offsetTop;
      const offsetTop =
        typeof rawOffsetTop === 'number' && Number.isFinite(rawOffsetTop) && rawOffsetTop > 0
          ? rawOffsetTop
          : 0;

      keyboardGeometryActive = true;
      document.documentElement.style.setProperty(APP_HEIGHT, `${viewportHeight}px`);
      document.documentElement.style.setProperty(APP_VIEWPORT_OFFSET_TOP, `${offsetTop}px`);
    };

    const scheduleFrame = (retainWithoutFocus: boolean) => {
      if (animationFrameId !== undefined) {
        retainWithoutFocusForQueuedFrame = retainWithoutFocusForQueuedFrame && retainWithoutFocus;
        return;
      }

      retainWithoutFocusForQueuedFrame = retainWithoutFocus;
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = undefined;
        const shouldRetainWithoutFocus = retainWithoutFocusForQueuedFrame;
        retainWithoutFocusForQueuedFrame = false;
        syncGeometry(shouldRetainWithoutFocus);
      });
    };

    const scheduleSync = () => {
      scheduleFrame(true);

      if (settleTimeoutId !== undefined) {
        window.clearTimeout(settleTimeoutId);
      }
      settleTimeoutId = window.setTimeout(() => {
        settleTimeoutId = undefined;
        scheduleFrame(false);
      }, SETTLE_DELAY_MS);
    };

    const forceNativeLayoutHeight = () => {
      nativeLayoutHeightForced = true;
      scheduleSync();
    };

    const startNativeKeyboardShow = () => {
      nativeLayoutHeightForced = false;
      scheduleSync();
    };

    const handleFocusIn = () => {
      if (nativePlatform) nativeLayoutHeightForced = false;
      scheduleSync();
    };

    const handleOrientationOrPageShow = nativePlatform ? forceNativeLayoutHeight : scheduleSync;

    const addKeyboardListener = (promise: Promise<PluginListenerHandle>) => {
      void promise
        .then((handle) => {
          if (disposed) {
            void handle.remove();
            return;
          }
          keyboardHandles.push(handle);
        })
        .catch(() => undefined);
    };

    scheduleSync();

    visualViewport.addEventListener('resize', scheduleSync);
    visualViewport.addEventListener('scroll', scheduleSync);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('orientationchange', handleOrientationOrPageShow);
    window.addEventListener('pageshow', handleOrientationOrPageShow);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', scheduleSync);

    if (nativePlatform && Capacitor.isPluginAvailable('Keyboard')) {
      addKeyboardListener(Keyboard.addListener('keyboardWillShow', startNativeKeyboardShow));
      addKeyboardListener(Keyboard.addListener('keyboardDidShow', startNativeKeyboardShow));
      addKeyboardListener(Keyboard.addListener('keyboardWillHide', forceNativeLayoutHeight));
      addKeyboardListener(Keyboard.addListener('keyboardDidHide', forceNativeLayoutHeight));
    }

    return () => {
      disposed = true;
      visualViewport.removeEventListener('resize', scheduleSync);
      visualViewport.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('orientationchange', handleOrientationOrPageShow);
      window.removeEventListener('pageshow', handleOrientationOrPageShow);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', scheduleSync);

      if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId);
      if (settleTimeoutId !== undefined) window.clearTimeout(settleTimeoutId);
      keyboardHandles.forEach((handle) => {
        void handle.remove();
      });
      clearGeometry();
    };
  }, []);
}
