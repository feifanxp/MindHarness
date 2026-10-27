// @vitest-environment jsdom
/* eslint-disable react/prop-types */
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UrlPreviewCard, UrlPreviewHolder } from './UrlPreviewCard';

const { mx } = vi.hoisted(() => ({ mx: { getUrlPreview: vi.fn() } }));

vi.mock('folds', () => {
  const tag = (name: string, extra = {}) =>
    React.forwardRef<HTMLElement, Record<string, unknown>>(({ children, style }, ref) =>
      React.createElement(name, { ref, style, ...extra }, children)
    );
  return {
    Box: tag('div'),
    Scroll: tag('div', { 'data-scroll': true }),
    Icon: ({ src }: { src: string }) => React.createElement('span', null, src),
    IconButton: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) =>
      React.createElement('button', { onClick }, children),
    Icons: { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' },
    Spinner: tag('span'),
    Text: tag('span'),
    as: (render: React.ForwardRefRenderFunction<HTMLElement, object>) => React.forwardRef(render),
    color: { Success: { Main: 'green' } },
    config: { space: { S200: '8px' } },
  };
});
vi.mock('./UrlPreview', () => {
  const tag = (name: string, extra = {}) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
      ({ children, ...props }, ref) =>
        React.createElement(name, { ...props, ...extra, ref }, children)
    );
  return {
    UrlPreview: tag('div', { 'data-preview': true }),
    UrlPreviewContent: tag('div'),
    UrlPreviewDescription: tag('span'),
    UrlPreviewImg: tag('img'),
  };
});
vi.mock('./UrlPreviewCard.css', () => ({
  UrlPreviewHolderGradient: () => 'gradient',
  UrlPreviewHolderBtn: () => 'arrow',
}));
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../utils/matrix', () => ({ mxcUrlToHttp: () => undefined }));
vi.mock('../ImageOverlay', () => ({ ImageOverlay: () => null }));
vi.mock('../image-viewer', () => ({ ImageViewer: () => null }));

let viewportWidth = 600;
let container: HTMLDivElement;
let root: Root;
const observers: Array<{
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];
const scrollTo = vi.fn();

const contentWidth = (scroll: HTMLElement) => {
  const count = scroll.firstElementChild?.childElementCount ?? 0;
  return count * 400 + Math.max(0, count - 1) * 8;
};
const viewport = () => container.querySelector<HTMLElement>('[data-scroll]')!;
const buttons = () => Array.from(container.querySelectorAll('button')).map((e) => e.textContent);
const notifyResize = () => {
  act(() =>
    observers.forEach((observer) => observer.callback([], observer as unknown as ResizeObserver))
  );
};
const renderCards = (urls: string[]) => {
  act(() => {
    root.render(
      React.createElement(
        UrlPreviewHolder,
        null,
        urls.map((url) => React.createElement(UrlPreviewCard, { key: url, url, ts: 1 }))
      )
    );
  });
};
const flushPreviews = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  notifyResize();
};
const moveTo = (position: number) => {
  act(() => {
    viewport().scrollLeft = position;
    viewport().dispatchEvent(new Event('scroll'));
  });
};

beforeEach(() => {
  viewportWidth = 600;
  mx.getUrlPreview.mockReset().mockResolvedValue({ 'og:title': 'Preview' });
  scrollTo.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();

      disconnect = vi.fn();

      constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
      }
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function measureViewport(
    this: HTMLElement
  ) {
    return this.hasAttribute('data-scroll') ? viewportWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function measureContent(
    this: HTMLElement
  ) {
    return this.hasAttribute('data-scroll') ? Math.max(viewportWidth, contentWidth(this)) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => viewportWidth);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.dir = '';
  observers.length = 0;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UrlPreviewHolder', () => {
  it('shows no controls when cards fit', async () => {
    renderCards(['https://one.example']);
    await flushPreviews();
    expect(buttons()).toEqual([]);
    expect(container.firstElementChild?.getAttribute('style')).toContain('margin-top: 8px');
    expect(observers[0].observe.mock.calls.map(([element]) => element)).toEqual([
      viewport(),
      viewport().firstElementChild,
    ]);
  });

  it('shows only the usable direction at either edge and both in the middle', async () => {
    renderCards(['https://one.example', 'https://two.example', 'https://three.example']);
    await flushPreviews();
    expect(buttons()).toEqual(['ArrowRight']);
    moveTo(200);
    expect(buttons()).toEqual(['ArrowLeft', 'ArrowRight']);
    // Keyboard order stays back control, cards, forward control.
    const [back, forward] = Array.from(container.querySelectorAll('button'));
    expect(
      back.compareDocumentPosition(viewport()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      forward.compareDocumentPosition(viewport()) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();
    moveTo(contentWidth(viewport()) - viewportWidth);
    expect(buttons()).toEqual(['ArrowLeft']);
    container.querySelector('button')!.click();
    expect(scrollTo).toHaveBeenCalledWith({ left: 616 - 600 / 1.3, behavior: 'smooth' });
  });

  it.each(['ltr', 'rtl'])('scrolls forward and back in %s layout', async (direction) => {
    renderCards(['https://one.example', 'https://two.example', 'https://three.example']);
    viewport().style.direction = direction;
    await flushPreviews();
    const sign = direction === 'rtl' ? -1 : 1;
    moveTo(sign * 200);
    const [previous, next] = Array.from(container.querySelectorAll('button'));
    next.click();
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: sign * (200 + 600 / 1.3),
      behavior: 'smooth',
    });
    previous.click();
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: sign * (200 - 600 / 1.3),
      behavior: 'smooth',
    });
  });

  it('updates when the viewport changes or mounted children grow', async () => {
    renderCards(['https://one.example', 'https://two.example']);
    await flushPreviews();
    expect(buttons()).toEqual(['ArrowRight']);
    viewportWidth = 900;
    notifyResize();
    expect(buttons()).toEqual([]);
    renderCards(['https://one.example', 'https://two.example', 'https://three.example']);
    await flushPreviews();
    expect(buttons()).toEqual(['ArrowRight']);
    viewportWidth = 0;
    notifyResize();
    expect(buttons()).toEqual([]);
    viewportWidth = 1300;
    notifyResize();
    expect(buttons()).toEqual([]);
  });

  it('removes stale arrows and spacing when all real preview requests fail, then recovers', async () => {
    let reject!: (error: Error) => void;
    const request = new Promise((_, fail) => {
      reject = fail;
    });
    mx.getUrlPreview.mockReturnValue(request);
    renderCards(['https://one.example', 'https://two.example', 'https://three.example']);
    expect(buttons()).toEqual(['ArrowRight']);
    await act(async () => {
      reject(new Error('Preview failed'));
    });
    notifyResize();
    expect(container.querySelectorAll('[data-preview]')).toHaveLength(0);
    expect(buttons()).toEqual([]);
    expect(container.firstElementChild?.getAttribute('style')).toContain('margin-top: 0px');
    mx.getUrlPreview.mockResolvedValue({ 'og:title': 'Recovered' });
    renderCards(['https://new.example']);
    await flushPreviews();
    expect(container.querySelectorAll('[data-preview]')).toHaveLength(1);
    expect(container.firstElementChild?.getAttribute('style')).toContain('margin-top: 8px');
  });

  it('keeps a successful card after another fails and hides unnecessary controls', async () => {
    let reject!: (error: Error) => void;
    mx.getUrlPreview.mockImplementation((url: string) =>
      url.includes('two')
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : Promise.resolve({ 'og:title': 'Kept' })
    );
    renderCards(['https://one.example', 'https://two.example']);
    await flushPreviews();
    expect(buttons()).toEqual(['ArrowRight']);
    await act(async () => {
      reject(new Error('Preview failed'));
    });
    notifyResize();
    expect(container.querySelectorAll('[data-preview]')).toHaveLength(1);
    expect(buttons()).toEqual([]);
    expect(container.textContent).toContain('Kept');
  });

  it('preserves RTL directions and clamps elastic overscroll', async () => {
    document.documentElement.dir = 'rtl';
    renderCards(['https://one.example', 'https://two.example']);
    viewport().style.direction = 'rtl';
    await flushPreviews();
    expect(buttons()).toEqual(['ArrowRight']);
    container.querySelector('button')!.click();
    expect(scrollTo).toHaveBeenCalledWith({ left: -600 / 1.3, behavior: 'smooth' });
    moveTo(-208);
    expect(buttons()).toEqual(['ArrowLeft']);
    moveTo(-300);
    expect(buttons()).toEqual(['ArrowLeft']);
    moveTo(30);
    expect(buttons()).toEqual(['ArrowRight']);
  });

  it('tolerates fractional scroll positions and disconnects on unmount', async () => {
    renderCards(['https://one.example', 'https://two.example']);
    await flushPreviews();
    moveTo(207.5);
    expect(buttons()).toEqual(['ArrowLeft']);
    const remove = vi.spyOn(viewport(), 'removeEventListener');
    const observer = observers[0];
    act(() => root.unmount());
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    root = createRoot(container);
  });
});
