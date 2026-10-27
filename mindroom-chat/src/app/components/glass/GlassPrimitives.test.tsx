// @vitest-environment jsdom
import React, { createRef } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Header, Menu, Modal, Surface } from './GlassPrimitives';
import { ScrollHeaderProvider } from './SurfaceContext';

vi.unmock('./GlassPrimitives');
vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: ({ variant }: { variant: string }) => `color-${variant}`,
}));

describe('shared surface appearance', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pointAt = (element: HTMLElement) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    element.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, clientY: 25 }));
    vi.runAllTimers();
    return element.style.getPropertyValue('--liquid-glass-light-x');
  };

  it.each([Menu, Modal, Dialog, Header, Surface])(
    'defaults to glass and cleans effects when appearance changes without replacing the element',
    (Component) => {
      const ref = createRef<HTMLElement>();
      const initial = Component === Header ? { appearance: 'glass' as const } : {};
      act(() => root.render(<Component as="section" ref={ref} {...initial} />));
      const element = ref.current!;
      expect(container.children).toHaveLength(1);
      expect(element.tagName).toBe('SECTION');
      expect(pointAt(element)).toBe('75%');

      for (const appearance of ['plain', 'inherit'] as const) {
        act(() => root.render(<Component as="section" ref={ref} appearance={appearance} />));
        expect(ref.current).toBe(element);
        expect(element.hasAttribute('appearance')).toBe(false);
        expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('');
        expect(pointAt(element)).toBe('');
      }

      act(() => root.render(<Component as="section" ref={ref} appearance="glass" />));
      expect(ref.current).toBe(element);
      expect(pointAt(element)).toBe('75%');
    }
  );

  it('inherits nested headers, honors explicit overrides, and gives portal menus their own glass', () => {
    act(() =>
      root.render(
        <Modal>
          <Header data-testid="inherited" />
          <Header data-testid="explicit" appearance="glass" />
          <Header data-testid="plain" appearance="plain">
            <Header data-testid="plain-child" />
          </Header>
          {createPortal(<Menu data-testid="portal-menu" />, container)}
        </Modal>
      )
    );
    const find = (testId: string) =>
      container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    expect(pointAt(find('inherited'))).toBe('');
    expect(pointAt(find('explicit'))).toBe('75%');
    expect(pointAt(find('plain'))).toBe('');
    expect(pointAt(find('plain-child'))).toBe('');
    expect(find('plain-child').getAttribute('data-glass-flat')).toBe('true');
    expect(pointAt(find('portal-menu'))).toBe('75%');
    expect(container.children).toHaveLength(2);
  });

  it.each(['Primary', 'Secondary', 'Success', 'Warning', 'Critical'] as const)(
    'keeps %s header foreground paired with its semantic material unless explicitly inherited',
    (variant) => {
      act(() =>
        root.render(
          <Modal>
            <Header variant={variant} />
          </Modal>
        )
      );
      const header = container.querySelector('header')!;
      expect(pointAt(header)).toBe('75%');
      act(() =>
        root.render(
          <Modal>
            <Header variant={variant} appearance="inherit" />
          </Modal>
        )
      );
      expect(pointAt(header)).toBe('');
    }
  );

  it('flattens standalone neutral headers but keeps explicit glass and semantic headers raised', () => {
    const ref = createRef<HTMLElement>();
    act(() => root.render(<Header ref={ref} />));
    const element = ref.current!;
    expect(element.getAttribute('data-glass-flat')).toBe('true');
    expect(pointAt(element)).toBe('');
    act(() => root.render(<Header ref={ref} appearance="glass" />));
    expect(ref.current).toBe(element);
    expect(element.hasAttribute('data-glass-flat')).toBe(false);
    expect(pointAt(element)).toBe('75%');
    act(() => root.render(<Header ref={ref} variant="Critical" />));
    expect(element.hasAttribute('data-glass-flat')).toBe(false);
    expect(pointAt(element)).toBe('75%');
    act(() => root.render(<Header ref={ref} flat={false} />));
    expect(element.hasAttribute('data-glass-flat')).toBe(false);
    expect(pointAt(element)).toBe('75%');
  });

  it('keeps scrolling titles free of pointer lighting while preserving explicit raised headers', () => {
    const ref = createRef<HTMLElement>();
    const renderHeader = (scrolling: boolean, flat?: boolean) => (
      <ScrollHeaderProvider value={scrolling}>
        <Header ref={ref} flat={flat} />
      </ScrollHeaderProvider>
    );
    act(() => root.render(renderHeader(false, false)));
    const element = ref.current!;
    expect(pointAt(element)).toBe('75%');
    act(() => root.render(renderHeader(true)));
    expect(ref.current).toBe(element);
    expect(element.style.getPropertyValue('--liquid-glass-light-x')).toBe('');
    expect(pointAt(element)).toBe('');
    expect(element.hasAttribute('flat')).toBe(false);
    act(() => root.render(renderHeader(true, false)));
    expect(pointAt(element)).toBe('75%');
  });
  it.each([Menu, Modal, Dialog, Surface])(
    'does not leak scrolling chrome through nested overlay portals',
    (Overlay) => {
      act(() =>
        root.render(
          <ScrollHeaderProvider value>
            <Header data-testid="title">
              {createPortal(
                <Overlay>
                  <Header data-testid="dialog-title" />
                </Overlay>,
                container
              )}
            </Header>
          </ScrollHeaderProvider>
        )
      );
      expect(
        container.querySelector('[data-testid="title"]')?.getAttribute('data-glass-flat')
      ).toBe('true');
      expect(
        container.querySelector('[data-testid="dialog-title"]')?.hasAttribute('data-glass-flat')
      ).toBe(false);
    }
  );
});
