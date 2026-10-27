import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useMobileKeyboardViewportFix } from './useMobileKeyboardViewportFix';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
    isPluginAvailable: vi.fn(),
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(),
  },
}));

type Listener = (...args: never[]) => void;

type ViewportTestEnv = {
  emitKeyboard: (eventName: string) => void;
  emitWindow: (eventName: string) => void;
  emitVisualViewportResize: () => void;
  emitVisualViewportScroll: () => void;
  flushAnimationFrames: () => void;
  setActiveElement: (element: 'editable' | 'none') => void;
  setInnerHeight: (height: number) => void;
  setVisualViewportHeight: (height: number) => void;
  setVisualViewportOffsetTop: (offsetTop: number) => void;
  setVisualViewportScale: (scale: number) => void;
  styleValues: Map<string, string>;
};

type ViewportTestEnvOptions = {
  autoFlushAnimationFrames?: boolean;
  honorCancelAnimationFrame?: boolean;
  isNativePlatform?: boolean;
  keyboardAvailable?: boolean;
  platform?: 'android' | 'ios' | 'web';
  userAgent?: string;
};

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36';

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

const FIREFOX_ANDROID_USER_AGENT =
  'Mozilla/5.0 (Android 15; Mobile; rv:136.0) Gecko/136.0 Firefox/136.0';

const UNKNOWN_BROWSER_USER_AGENT = 'ExampleBrowser/1.0';

function TestViewportHook() {
  useMobileKeyboardViewportFix();
  return null;
}

const createListenerMap = () => new Map<string, Set<Listener>>();

const addListener = (
  listeners: Map<string, Set<Listener>>,
  eventName: string,
  listener: Listener
) => {
  const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
  eventListeners.add(listener);
  listeners.set(eventName, eventListeners);
};

const removeListener = (
  listeners: Map<string, Set<Listener>>,
  eventName: string,
  listener: Listener
) => {
  listeners.get(eventName)?.delete(listener);
};

const emit = (listeners: Map<string, Set<Listener>>, eventName: string) => {
  listeners.get(eventName)?.forEach((listener) => listener());
};

const createActiveElement = (): Pick<Element, 'getAttribute' | 'nodeName'> => ({
  getAttribute: vi.fn(() => null),
  nodeName: 'TEXTAREA',
});

const installViewportTestEnv = ({
  autoFlushAnimationFrames = true,
  honorCancelAnimationFrame = true,
  isNativePlatform = false,
  keyboardAvailable = false,
  platform = 'web',
  userAgent = ANDROID_USER_AGENT,
}: ViewportTestEnvOptions = {}): ViewportTestEnv => {
  const visualViewportListeners = createListenerMap();
  const windowListeners = createListenerMap();
  const keyboardListeners = createListenerMap();
  const styleValues = new Map<string, string>();
  let innerHeight = 800;
  let visualViewportHeight = 800;
  let visualViewportOffsetTop = 0;
  let visualViewportScale = 1;
  let activeElement: Pick<Element, 'getAttribute' | 'nodeName'> | undefined;
  const animationFrames = new Map<number, FrameRequestCallback>();

  const style = {
    removeProperty: vi.fn((propertyName: string) => {
      styleValues.delete(propertyName);
    }),
    setProperty: vi.fn((propertyName: string, value: string) => {
      styleValues.set(propertyName, value);
    }),
  };

  const documentStub = {
    documentElement: {
      clientHeight: innerHeight,
      style,
    },
  };
  Object.defineProperty(documentStub, 'activeElement', {
    configurable: true,
    get: () => activeElement,
  });
  vi.stubGlobal('document', documentStub);

  vi.stubGlobal('window', {
    addEventListener: vi.fn((eventName: string, listener: Listener) =>
      addListener(windowListeners, eventName, listener)
    ),
    get innerHeight() {
      return innerHeight;
    },
    navigator: {
      userAgent,
    },
    removeEventListener: vi.fn((eventName: string, listener: Listener) =>
      removeListener(windowListeners, eventName, listener)
    ),
    scrollTo: vi.fn(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    visualViewport: {
      addEventListener: vi.fn((eventName: string, listener: Listener) =>
        addListener(visualViewportListeners, eventName, listener)
      ),
      get height() {
        return visualViewportHeight;
      },
      get offsetTop() {
        return visualViewportOffsetTop;
      },
      get scale() {
        return visualViewportScale;
      },
      removeEventListener: vi.fn((eventName: string, listener: Listener) =>
        removeListener(visualViewportListeners, eventName, listener)
      ),
    },
  });

  let rafId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      rafId += 1;
      animationFrames.set(rafId, callback);
      if (autoFlushAnimationFrames) {
        const nextRafId = rafId;
        queueMicrotask(() => {
          const animationFrame = animationFrames.get(nextRafId);
          if (!animationFrame) return;

          animationFrames.delete(nextRafId);
          animationFrame(0);
        });
      }
      return rafId;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((canceledRafId: number) => {
      if (honorCancelAnimationFrame) {
        animationFrames.delete(canceledRafId);
      }
    })
  );

  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(isNativePlatform);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(keyboardAvailable);
  vi.mocked(Keyboard.addListener).mockImplementation((eventName, listener) => {
    addListener(keyboardListeners, eventName, listener as Listener);
    return Promise.resolve({
      remove: vi.fn(() => {
        removeListener(keyboardListeners, eventName, listener as Listener);
        return Promise.resolve();
      }),
    });
  });

  return {
    emitKeyboard: (eventName) => emit(keyboardListeners, eventName),
    emitWindow: (eventName) => emit(windowListeners, eventName),
    emitVisualViewportResize: () => emit(visualViewportListeners, 'resize'),
    emitVisualViewportScroll: () => emit(visualViewportListeners, 'scroll'),
    flushAnimationFrames: () => {
      const pendingAnimationFrames = Array.from(animationFrames.values());
      animationFrames.clear();
      pendingAnimationFrames.forEach((callback) => callback(0));
    },
    setActiveElement: (element) => {
      activeElement = element === 'editable' ? createActiveElement() : undefined;
    },
    setInnerHeight: (height) => {
      innerHeight = height;
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: height,
      });
    },
    setVisualViewportHeight: (height) => {
      visualViewportHeight = height;
    },
    setVisualViewportOffsetTop: (offsetTop) => {
      visualViewportOffsetTop = offsetTop;
    },
    setVisualViewportScale: (scale) => {
      visualViewportScale = scale;
    },
    styleValues,
  };
};

describe('useMobileKeyboardViewportFix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['Safari on iOS', IOS_USER_AGENT],
    ['Chrome on Android', ANDROID_USER_AGENT],
    ['Firefox on Android', FIREFOX_ANDROID_USER_AGENT],
    ['an unknown browser', UNKNOWN_BROWSER_USER_AGENT],
  ])(
    'follows a keyboard-panned visual viewport in %s when it exposes affected geometry',
    async (_browser, userAgent) => {
      const env = installViewportTestEnv({ userAgent });
      env.setActiveElement('editable');

      let renderer: ReturnType<typeof create> | undefined;
      await act(async () => {
        renderer = create(React.createElement(TestViewportHook));
      });

      env.setVisualViewportHeight(457);
      env.setVisualViewportOffsetTop(170);
      await act(async () => {
        env.emitVisualViewportScroll();
      });

      expect(env.styleValues.get('--app-height')).toBe('457px');
      expect(env.styleValues.get('--app-viewport-offset-top')).toBe('170px');

      await act(async () => {
        renderer?.unmount();
      });
    }
  );

  it('does not treat browser chrome movement as a keyboard without a focused editor', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(700);
    env.setVisualViewportOffsetTop(100);
    await act(async () => {
      env.emitVisualViewportScroll();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('stops following browser chrome after the editor loses focus', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(457);
    env.setVisualViewportOffsetTop(170);
    await act(async () => {
      env.emitVisualViewportResize();
    });
    expect(env.styleValues.get('--app-height')).toBe('457px');

    env.setActiveElement('none');
    env.setVisualViewportHeight(700);
    env.setVisualViewportOffsetTop(0);
    await act(async () => {
      env.emitWindow('focusout');
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 120);
      });
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not treat pinch zoom as a software keyboard', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(400);
    env.setVisualViewportOffsetTop(120);
    env.setVisualViewportScale(2);
    await act(async () => {
      env.emitVisualViewportScroll();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does nothing when the browser already resizes the layout viewport', async () => {
    const env = installViewportTestEnv({ userAgent: ANDROID_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setInnerHeight(457);
    env.setVisualViewportHeight(457);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('restores native app height when keyboard hide leaves visualViewport stale', async () => {
    const env = installViewportTestEnv({
      isNativePlatform: true,
      keyboardAvailable: true,
      platform: 'android',
    });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setInnerHeight(500);
    env.setVisualViewportHeight(500);
    await act(async () => {
      env.emitVisualViewportResize();
    });
    expect(env.styleValues.get('--app-height')).toBeUndefined();

    env.setInnerHeight(800);
    await act(async () => {
      env.emitKeyboard('keyboardDidHide');
    });

    expect(env.styleValues.get('--app-height')).toBe('800px');
    expect(env.styleValues.get('--app-viewport-offset-top')).toBe('0px');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it.each(['orientationchange', 'pageshow'])(
    'uses native layout height after %s when visualViewport is stale',
    async (eventName) => {
      const env = installViewportTestEnv({
        isNativePlatform: true,
        keyboardAvailable: false,
        platform: 'ios',
      });

      let renderer: ReturnType<typeof create> | undefined;
      await act(async () => {
        renderer = create(React.createElement(TestViewportHook));
      });

      env.setInnerHeight(800);
      env.setVisualViewportHeight(500);
      await act(async () => {
        env.emitWindow(eventName);
      });

      expect(env.styleValues.get('--app-height')).toBe('800px');
      expect(env.styleValues.get('--app-viewport-offset-top')).toBe('0px');

      await act(async () => {
        renderer?.unmount();
      });
    }
  );

  it('restores normal flow when the keyboard closes with the editor still focused', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(457);
    env.setVisualViewportOffsetTop(170);
    await act(async () => {
      env.emitVisualViewportResize();
    });
    expect(env.styleValues.get('--app-height')).toBe('457px');

    env.setVisualViewportHeight(800);
    env.setVisualViewportOffsetTop(0);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it.each([0, 24])(
    'ignores the iOS 26 stale 24px viewport after keyboard close with offset %i',
    async (staleOffsetTop) => {
      const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
      env.setActiveElement('editable');

      let renderer: ReturnType<typeof create> | undefined;
      await act(async () => {
        renderer = create(React.createElement(TestViewportHook));
      });

      env.setVisualViewportHeight(457);
      env.setVisualViewportOffsetTop(170);
      await act(async () => {
        env.emitVisualViewportResize();
      });
      expect(env.styleValues.get('--app-height')).toBe('457px');

      env.setVisualViewportHeight(776);
      env.setVisualViewportOffsetTop(staleOffsetTop);
      await act(async () => {
        env.emitVisualViewportResize();
      });

      expect(env.styleValues.get('--app-height')).toBeUndefined();
      expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();

      await act(async () => {
        renderer?.unmount();
      });
    }
  );

  it('accepts a 48px viewport reduction as keyboard geometry', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(752);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(env.styleValues.get('--app-height')).toBe('752px');
    expect(env.styleValues.get('--app-viewport-offset-top')).toBe('0px');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('remeasures after WebKit publishes a delayed keyboard offset', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });
    env.setActiveElement('editable');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(457);
    await act(async () => {
      env.emitVisualViewportResize();
    });
    expect(env.styleValues.get('--app-viewport-offset-top')).toBe('0px');

    env.setVisualViewportOffsetTop(170);
    await act(async () => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 120);
      });
    });

    expect(env.styleValues.get('--app-viewport-offset-top')).toBe('170px');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('ignores pending animation frame writes after cleanup', async () => {
    const env = installViewportTestEnv({
      autoFlushAnimationFrames: false,
      honorCancelAnimationFrame: false,
    });
    env.setActiveElement('editable');
    env.setVisualViewportHeight(457);

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    await act(async () => {
      renderer?.unmount();
    });

    await act(async () => {
      env.flushAnimationFrames();
    });

    expect(env.styleValues.get('--app-height')).toBeUndefined();
    expect(env.styleValues.get('--app-viewport-offset-top')).toBeUndefined();
  });

  it('never calls window.scrollTo (CINNY-053 regression lock)', async () => {
    const env = installViewportTestEnv({ userAgent: IOS_USER_AGENT });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(React.createElement(TestViewportHook));
    });

    env.setVisualViewportHeight(457);
    await act(async () => {
      env.emitVisualViewportResize();
    });

    expect(window.scrollTo).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });
});
