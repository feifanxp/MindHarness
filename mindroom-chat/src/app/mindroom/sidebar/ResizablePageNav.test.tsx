import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { ResizablePageNav } from './ResizablePageNav';
import { ResizablePanel } from './ResizablePanel';

vi.mock('./ResizablePanel.css', () => ({ Panel: 'panel', Handle: 'handle' }));
vi.mock('../../components/page', () => ({
  PageNav: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@alice:example.org' }),
}));

const storageKey = 'mindroom.pageNav.width:@alice:example.org';
const membersStorageKey = 'mindroom.members.width:@alice:example.org';
const storage = new Map<string, string>();
let availableWidth = 1000;
let direction = 'ltr';
let paddingLeft = 0;
let paddingRight = 0;
let resizeObserver: () => void;
const capture = new Set<number>();
const pointerTarget = {
  setPointerCapture: (id: number) => capture.add(id),
  hasPointerCapture: (id: number) => capture.has(id),
  releasePointerCapture: (id: number) => capture.delete(id),
};
const pointer = (x: number, pointerType = 'mouse', pointerId = 1) => ({
  button: 0,
  isPrimary: true,
  pointerId,
  pointerType,
  clientX: x,
  currentTarget: pointerTarget,
  preventDefault: vi.fn(),
});

const renderPanel = (screenSize = ScreenSize.Desktop, onCollapse?: () => void, members = false) => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ScreenSizeProvider value={screenSize}>
        {members ? (
          <ResizablePanel
            side="end"
            storageKey={membersStorageKey}
            defaultWidth={266}
            minContentWidth={screenSize === ScreenSize.Mobile ? 0 : 200}
            resizeLabel="Resize member panel"
            collapseLabel="Hide Members"
            testId="resizable-members-panel"
            onCollapse={onCollapse}
          >
            <span>Members</span>
          </ResizablePanel>
        ) : (
          <ResizablePageNav onCollapse={onCollapse}>
            <span>Room list</span>
          </ResizablePageNav>
        )}
      </ScreenSizeProvider>,
      {
        createNodeMock: () => ({
          parentElement: {
            get clientWidth() {
              return availableWidth;
            },
          },
        }),
      }
    );
  });
  const handle = () => renderer!.root.findByProps({ role: 'separator' });
  const width = () =>
    renderer!.root.findByProps({
      'data-testid': members ? 'resizable-members-panel' : 'resizable-page-nav',
    }).props.style.width;
  return { renderer: renderer!, handle, width };
};

beforeEach(() => {
  storage.clear();
  capture.clear();
  availableWidth = 1000;
  direction = 'ltr';
  paddingLeft = 0;
  paddingRight = 0;
  vi.stubGlobal('getComputedStyle', () => ({
    direction,
    paddingLeft: `${paddingLeft}px`,
    paddingRight: `${paddingRight}px`,
  }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeObserver = callback;
      }

      observe() {}

      disconnect() {}
    }
  );
});

describe('ResizablePanel at the member edge', () => {
  it.each(['ltr', 'rtl'])('keeps the maximum width inside safe-area padding in %s', (layout) => {
    direction = layout;
    availableWidth = 390;
    paddingLeft = 44;
    paddingRight = 32;
    storage.set(membersStorageKey, '500');
    const { renderer, handle, width } = renderPanel(ScreenSize.Mobile, undefined, true);
    expect(width()).toBe(314);
    expect(handle().props['aria-valuemax']).toBe(314);
    paddingLeft = 0;
    act(() => resizeObserver());
    expect(width()).toBe(358);
    act(() => renderer.unmount());
  });

  it.each([
    { layout: 'ltr', endX: 600, arrow: 'ArrowLeft' },
    { layout: 'rtl', endX: 800, arrow: 'ArrowRight' },
  ])(
    'grows toward the conversation in $layout and saves an independent width',
    ({ layout, endX, arrow }) => {
      direction = layout;
      storage.set(storageKey, '420');
      const { renderer, handle, width } = renderPanel(ScreenSize.Tablet, undefined, true);
      expect(width()).toBe(266);
      act(() => handle().props.onPointerDown(pointer(700)));
      act(() => handle().props.onPointerMove(pointer(endX)));
      expect(width()).toBe(366);
      expect(storage.has(membersStorageKey)).toBe(false);
      act(() => handle().props.onPointerUp(pointer(endX)));
      expect(storage.get(membersStorageKey)).toBe('366');
      act(() => handle().props.onKeyDown({ key: arrow, preventDefault: vi.fn() }));
      expect(width()).toBe(386);
      expect(storage.get(storageKey)).toBe('420');
      act(() => renderer.unmount());
      const reopened = renderPanel(ScreenSize.Tablet, undefined, true);
      expect(reopened.width()).toBe(386);
      act(() => reopened.renderer.unmount());
    }
  );

  it.each(['mouse', 'touch', 'pen'])(
    'collapses with %s and reopens at the last usable width',
    (pointerType) => {
      storage.set(membersStorageKey, '366');
      const onCollapse = vi.fn();
      const { renderer, handle, width } = renderPanel(ScreenSize.Tablet, onCollapse, true);
      act(() => handle().props.onPointerDown(pointer(700, pointerType)));
      act(() => handle().props.onPointerMove(pointer(906, pointerType)));
      expect(width()).toBe(0);
      expect(handle().props['aria-valuetext']).toBe('Hide Members');
      expect(onCollapse).not.toHaveBeenCalled();
      act(() => handle().props.onPointerUp(pointer(906, pointerType)));
      expect(onCollapse).toHaveBeenCalledTimes(1);
      expect(storage.get(membersStorageKey)).toBe('366');
      act(() => renderer.unmount());
      const reopened = renderPanel(ScreenSize.Tablet, onCollapse, true);
      expect(reopened.width()).toBe(366);
      act(() => reopened.renderer.unmount());
    }
  );

  it('keeps the member panel usable in a narrow split layout', () => {
    availableWidth = 360;
    const { renderer, width } = renderPanel(ScreenSize.Tablet, undefined, true);
    expect(width()).toBe(200);
    expect(storage.has(membersStorageKey)).toBe(false);
    act(() => renderer.unmount());
  });

  it('resizes the phone overlay within its viewport', () => {
    availableWidth = 375;
    storage.set(membersStorageKey, '500');
    const { renderer, handle, width } = renderPanel(ScreenSize.Mobile, undefined, true);
    expect(width()).toBe(375);
    act(() => handle().props.onPointerDown(pointer(0, 'touch')));
    act(() => handle().props.onPointerMove(pointer(100, 'touch')));
    expect(width()).toBe(275);
    act(() => handle().props.onPointerUp(pointer(100, 'touch')));
    expect(storage.get(membersStorageKey)).toBe('275');
    act(() => renderer.unmount());
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ResizablePageNav', () => {
  it.each(['mouse', 'touch', 'pen'])(
    'previews collapse with %s, commits on release, and preserves the previous width',
    (pointerType) => {
      storage.set(storageKey, '356');
      const onCollapse = vi.fn();
      const { renderer, handle, width } = renderPanel(ScreenSize.Tablet, onCollapse);
      act(() => handle().props.onPointerDown(pointer(356, pointerType)));
      act(() => handle().props.onPointerMove(pointer(190, pointerType)));
      expect(width()).toBe(200);
      act(() => handle().props.onPointerMove(pointer(160, pointerType)));
      expect(width()).toBe(0);
      expect(handle().props['aria-valuenow']).toBe(0);
      expect(handle().props['aria-valuetext']).toBe('Collapse navigation panel');
      expect(onCollapse).not.toHaveBeenCalled();
      expect(storage.get(storageKey)).toBe('356');
      act(() => handle().props.onPointerUp(pointer(160, pointerType)));
      expect(onCollapse).toHaveBeenCalledTimes(1);
      expect(storage.get(storageKey)).toBe('356');
      expect(capture.size).toBe(0);
      act(() => renderer.unmount());
      const reopened = renderPanel(ScreenSize.Tablet, onCollapse);
      expect(reopened.width()).toBe(356);
      act(() => reopened.renderer.unmount());
    }
  );

  it('lets a drag leave the collapse preview without flickering near the threshold', () => {
    const onCollapse = vi.fn();
    const { renderer, handle, width } = renderPanel(ScreenSize.Desktop, onCollapse);
    act(() => handle().props.onPointerDown(pointer(256)));
    act(() => handle().props.onPointerMove(pointer(160)));
    expect(width()).toBe(0);
    act(() => handle().props.onPointerMove(pointer(170)));
    expect(width()).toBe(0);
    act(() => handle().props.onPointerMove(pointer(180)));
    expect(width()).toBe(200);
    act(() => handle().props.onPointerUp(pointer(180)));
    expect(onCollapse).not.toHaveBeenCalled();
    expect(storage.get(storageKey)).toBe('200');
    act(() => renderer.unmount());
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])(
    'cancels a collapse preview on %s without saving a tiny width',
    (event) => {
      const onCollapse = vi.fn();
      const { renderer, handle, width } = renderPanel(ScreenSize.Desktop, onCollapse);
      act(() => handle().props.onPointerDown(pointer(256)));
      act(() => handle().props.onPointerMove(pointer(150)));
      expect(width()).toBe(0);
      act(() => handle().props[event](pointer(150)));
      expect(width()).toBe(256);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(storage.has(storageKey)).toBe(false);
      act(() => renderer.unmount());
    }
  );

  it('previews collapse when dragging inward in RTL', () => {
    direction = 'rtl';
    const onCollapse = vi.fn();
    const { renderer, handle, width } = renderPanel(ScreenSize.Desktop, onCollapse);
    act(() => handle().props.onPointerDown(pointer(800)));
    act(() => handle().props.onPointerMove(pointer(906)));
    expect(width()).toBe(0);
    act(() => handle().props.onPointerUp(pointer(906)));
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(storage.has(storageKey)).toBe(false);
    act(() => renderer.unmount());
  });

  it('keeps resizing bounded when the owner does not support collapse', () => {
    const { renderer, handle, width } = renderPanel();
    act(() => handle().props.onPointerDown(pointer(256)));
    act(() => handle().props.onPointerMove(pointer(100)));
    expect(width()).toBe(200);
    act(() => handle().props.onPointerUp(pointer(100)));
    expect(storage.get(storageKey)).toBe('200');
    act(() => renderer.unmount());
  });

  it('expands toward the content in right-to-left layouts', () => {
    direction = 'rtl';
    const { renderer, handle, width } = renderPanel();
    act(() => handle().props.onPointerDown(pointer(800)));
    act(() => handle().props.onPointerMove(pointer(700)));
    act(() => handle().props.onPointerUp(pointer(700)));
    expect(width()).toBe(356);
    act(() => handle().props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }));
    expect(width()).toBe(376);
    act(() => renderer.unmount());
  });
  it.each(['mouse', 'touch', 'pen'])('resizes with %s and saves only on release', (pointerType) => {
    const { renderer, handle, width } = renderPanel();
    expect(width()).toBe(256);
    act(() => handle().props.onPointerDown(pointer(256, pointerType)));
    act(() => handle().props.onPointerMove(pointer(356, pointerType)));
    expect(width()).toBe(356);
    expect(storage.has(storageKey)).toBe(false);
    act(() => handle().props.onPointerUp(pointer(356, pointerType)));
    expect(storage.get(storageKey)).toBe('356');
    expect(capture.size).toBe(0);
    act(() => renderer.unmount());
    const restored = renderPanel();
    expect(restored.width()).toBe(356);
    act(() => restored.renderer.unmount());
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'])(
    'discards an interrupted drag on %s',
    (event) => {
      const { renderer, handle, width } = renderPanel();
      act(() => handle().props.onPointerDown(pointer(256)));
      act(() => handle().props.onPointerMove(pointer(400)));
      act(() => handle().props[event](pointer(400)));
      expect(width()).toBe(256);
      expect(storage.has(storageKey)).toBe(false);
      act(() => renderer.unmount());
    }
  );

  it('ignores secondary pointers and right-button drags', () => {
    const { renderer, handle, width } = renderPanel();
    act(() => handle().props.onPointerDown({ ...pointer(256), button: 2 }));
    act(() => handle().props.onPointerMove(pointer(400)));
    expect(width()).toBe(256);
    act(() => handle().props.onPointerDown(pointer(256)));
    act(() => handle().props.onPointerDown({ ...pointer(256, 'touch', 2), isPrimary: false }));
    act(() => handle().props.onPointerMove(pointer(400, 'touch', 2)));
    act(() => handle().props.onPointerUp(pointer(400, 'touch', 2)));
    expect(width()).toBe(256);
    expect(capture.has(1)).toBe(true);
    act(() => handle().props.onPointerMove(pointer(300)));
    act(() => handle().props.onPointerUp(pointer(300)));
    expect(width()).toBe(300);
    act(() => renderer.unmount());
  });

  it('clamps to available space without overwriting the saved width on viewport changes', () => {
    storage.set(storageKey, '500');
    const { renderer, width } = renderPanel();
    expect(width()).toBe(500);
    availableWidth = 700;
    act(() => resizeObserver());
    expect(width()).toBe(380);
    expect(storage.get(storageKey)).toBe('500');
    availableWidth = 1000;
    act(() => resizeObserver());
    expect(width()).toBe(500);
    act(() => renderer.unmount());
  });

  it.each([undefined, '220', '600'])(
    'has no resize handle on phones with saved width %s',
    (saved) => {
      availableWidth = 309;
      if (saved) storage.set(storageKey, saved);
      const { renderer } = renderPanel(ScreenSize.Mobile);
      expect(renderer.root.findAllByProps({ role: 'separator' })).toHaveLength(0);
      expect(storage.get(storageKey)).toBe(saved);
      act(() => renderer.unmount());
    }
  );

  it.each([
    { pointerX: 400, preview: 400 },
    { pointerX: 150, preview: 0 },
  ])(
    'discards the $preview px preview on mobile and restores the saved width',
    ({ pointerX, preview }) => {
      storage.set(storageKey, '300');
      const onCollapse = vi.fn();
      const { renderer, handle, width } = renderPanel(ScreenSize.Tablet, onCollapse);
      act(() => handle().props.onPointerDown(pointer(300)));
      act(() => handle().props.onPointerMove(pointer(pointerX)));
      expect(width()).toBe(preview);
      const changeScreen = (screenSize: ScreenSize) =>
        act(() => {
          renderer.update(
            <ScreenSizeProvider value={screenSize}>
              <ResizablePageNav onCollapse={onCollapse}>
                <span>Room list</span>
              </ResizablePageNav>
            </ScreenSizeProvider>
          );
        });
      changeScreen(ScreenSize.Mobile);
      expect(renderer.root.findAllByProps({ role: 'separator' })).toHaveLength(0);
      expect(storage.get(storageKey)).toBe('300');
      changeScreen(ScreenSize.Tablet);
      expect(width()).toBe(300);
      act(() => handle().props.onPointerDown(pointer(300)));
      act(() => handle().props.onPointerMove(pointer(320)));
      act(() => handle().props.onPointerUp(pointer(320)));
      expect(width()).toBe(320);
      expect(storage.get(storageKey)).toBe('320');
      expect(onCollapse).not.toHaveBeenCalled();
      act(() => renderer.unmount());
    }
  );

  it('supports bounded keyboard resizing and reset', () => {
    const onCollapse = vi.fn();
    const { renderer, handle, width } = renderPanel(ScreenSize.Desktop, onCollapse);
    const key = (value: string) =>
      act(() => handle().props.onKeyDown({ key: value, preventDefault: vi.fn() }));
    key('ArrowRight');
    expect(width()).toBe(276);
    key('Home');
    expect(width()).toBe(200);
    key('End');
    expect(width()).toBe(600);
    expect(handle().props['aria-valuenow']).toBe(600);
    key('ArrowLeft');
    expect(width()).toBe(580);
    key('Enter');
    expect(width()).toBe(256);
    expect(storage.get(storageKey)).toBe('256');
    expect(onCollapse).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it.each(['"wide"', 'null', '-10', '100000', '{broken'])(
    'handles malformed or out-of-range saved widths: %s',
    (value) => {
      storage.set(storageKey, value);
      const { renderer, width } = renderPanel();
      expect(width()).toBeGreaterThanOrEqual(200);
      expect(width()).toBeLessThanOrEqual(600);
      act(() => renderer.unmount());
    }
  );
});
