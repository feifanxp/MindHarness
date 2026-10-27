// @vitest-environment jsdom
import React, { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadTimelineHeader } from './ThreadTimelineHeader';

describe('ThreadTimelineHeader', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resize: () => void;
  let frame: FrameRequestCallback | undefined;
  let bannerHeight: number;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }

        observe() {}

        disconnect() {}
      }
    );
    bannerHeight = 80;
    // The banner and its controls, inside the sticky header.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(
      this: HTMLElement
    ) {
      return this.parentElement?.style.position === 'sticky' ? bannerHeight : 0;
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps its height until the next frame and reports each change before it', () => {
    const scrollRef = createRef<HTMLDivElement>();
    // The header has its new height when the timeline holds the reader.
    const onResize = vi.fn(
      () => (scrollRef.current!.firstElementChild as HTMLElement).style.height
    );
    act(() =>
      root.render(
        <div ref={scrollRef}>
          <ThreadTimelineHeader scrollRef={scrollRef} expansionControl={null} onResize={onResize}>
            <div />
          </ThreadTimelineHeader>
        </div>
      )
    );
    const scroll = scrollRef.current!;
    const header = scroll.firstElementChild as HTMLElement;
    // At the bottom, a layout of the resized header clamps the offset.
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => (header.style.height === '80px' ? 300 : 278),
    });
    expect(header.style.height).toBe('80px');

    // A tag row appears: the rows below must not move before the timeline knows.
    bannerHeight = 102;
    resize();
    expect(header.style.height).toBe('80px');
    expect(onResize).not.toHaveBeenCalled();

    frame?.(0);
    expect(onResize).toHaveBeenCalledWith(22, 300);
    expect(onResize).toHaveReturnedWith('102px');
    expect(header.style.height).toBe('102px');
    expect(scroll.style.scrollPaddingTop).toBe('calc(var(--room-header-height, 0px) + 102px)');
  });
});
