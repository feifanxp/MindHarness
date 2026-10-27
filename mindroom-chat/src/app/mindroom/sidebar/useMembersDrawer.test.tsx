import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { settingsAtom } from '../../state/settings';
import { useMembersDrawer } from './useMembersDrawer';

const account = vi.hoisted(() => ({ userId: '@alice:example.org' }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => account.userId }),
}));

function Toggle() {
  const [open, setOpen] = useMembersDrawer();
  return (
    <button type="button" aria-pressed={open} onClick={() => setOpen(!open)}>
      Members
    </button>
  );
}

const renderDrawer = (initialScreen: ScreenSize, desktopOpen = true) => {
  const store = createStore();
  store.set(settingsAtom, { ...store.get(settingsAtom), isPeopleDrawer: desktopOpen });
  const viewport = { width: initialScreen === ScreenSize.Mobile ? 390 : 1200 };
  vi.stubGlobal('document', {
    body: {
      get clientWidth() {
        return viewport.width;
      },
    },
  });
  const content = (screen: ScreenSize) => (
    <Provider store={store}>
      <ScreenSizeProvider value={screen}>
        <Toggle />
        <Toggle />
      </ScreenSizeProvider>
    </Provider>
  );
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(content(initialScreen));
  });
  return {
    store,
    pressed: () =>
      renderer!.root.findAllByType('button').map((button) => button.props['aria-pressed']),
    click: () => act(() => renderer!.root.findAllByType('button')[0].props.onClick()),
    captureClick: () => renderer!.root.findAllByType('button')[0].props.onClick,
    resize: (screen: ScreenSize) => {
      viewport.width = screen === ScreenSize.Mobile ? 390 : 1200;
      act(() => renderer!.update(content(screen)));
    },
    setViewportWidth: (width: number) => {
      viewport.width = width;
    },
    unmount: () => {
      act(() => renderer!.unmount());
      vi.unstubAllGlobals();
    },
  };
};

afterEach(() => {
  account.userId = '@alice:example.org';
  vi.unstubAllGlobals();
});

describe('useMembersDrawer', () => {
  it('opens the phone overlay explicitly without changing the saved split-layout choice', () => {
    const drawer = renderDrawer(ScreenSize.Mobile);
    expect(drawer.pressed()).toEqual([false, false]);
    drawer.click();
    expect(drawer.pressed()).toEqual([true, true]);
    drawer.click();
    expect(drawer.pressed()).toEqual([false, false]);
    expect(drawer.store.get(settingsAtom).isPeopleDrawer).toBe(true);
    drawer.resize(ScreenSize.Tablet);
    expect(drawer.pressed()).toEqual([true, true]);
    drawer.click();
    expect(drawer.store.get(settingsAtom).isPeopleDrawer).toBe(false);
    drawer.resize(ScreenSize.Desktop);
    expect(drawer.pressed()).toEqual([false, false]);
    drawer.unmount();
  });

  it('keeps phone opening state separate for each account', () => {
    const drawer = renderDrawer(ScreenSize.Mobile);
    drawer.click();
    account.userId = '@bob:example.org';
    drawer.resize(ScreenSize.Mobile);
    expect(drawer.pressed()).toEqual([false, false]);
    account.userId = '@alice:example.org';
    drawer.resize(ScreenSize.Mobile);
    expect(drawer.pressed()).toEqual([true, true]);
    drawer.unmount();
  });

  it('opens the phone overlay when a desktop callback runs after a viewport resize', () => {
    const drawer = renderDrawer(ScreenSize.Desktop, false);
    const desktopClick = drawer.captureClick();
    drawer.setViewportWidth(390);
    try {
      act(() => desktopClick());
      drawer.resize(ScreenSize.Mobile);
      expect(drawer.pressed()).toEqual([true, true]);
      expect(drawer.store.get(settingsAtom).isPeopleDrawer).toBe(false);
    } finally {
      drawer.unmount();
    }
  });
});
