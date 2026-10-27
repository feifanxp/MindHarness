// @vitest-environment jsdom

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizablePanel } from './ResizablePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./ResizablePanel.css', () => ({ Panel: 'panel', Handle: 'handle' }));

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<React.ComponentProps<typeof ResizablePanel>>) =>
  act(() => {
    root.render(
      <ResizablePanel
        storageKey="test.width"
        resizeLabel="Resize"
        collapseLabel="Close"
        testId="panel"
        side="end"
        minContentWidth={0}
        {...props}
      >
        <div>content</div>
      </ResizablePanel>
    );
  });

const panel = () => container.querySelector('[data-testid="panel"]') as HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}

      disconnect() {}
    }
  );
  container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 3000 });
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ResizablePanel width bounds', () => {
  it('keeps stored widths within the default 600 px', () => {
    localStorage.setItem('test.width', JSON.stringify(1200));
    render({});
    expect(panel().style.width).toBe('600px');
  });

  it('lets a panel opt into a wider maximum', () => {
    localStorage.setItem('test.width', JSON.stringify(1200));
    render({ maxPanelWidth: 1600 });
    expect(panel().style.width).toBe('1200px');
  });

  it('renders no box and no handle in passthrough mode', () => {
    render({ passthrough: true });
    expect(panel().style.display).toBe('contents');
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });
});
