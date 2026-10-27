// @vitest-environment jsdom
/* eslint-disable react/prop-types */
import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindroomThreadSummaryMarker } from './MindroomThreadSummaryMarker';

vi.mock('folds', () => ({
  Box: ({ as: Tag = 'div', children, ...props }: any) => React.createElement(Tag, props, children),
  Text: ({ as: Tag = 'span', children, size, priority, ...props }: any) =>
    React.createElement(Tag, props, children),
  Tooltip: ({ children, ...props }: any) =>
    React.createElement('div', { ...props, 'data-tooltip': true }, children),
  PopOut: ({ anchor, content, position, align, offset, ...props }: any) =>
    anchor
      ? React.createElement('div', { ...props, 'data-popout': true, 'data-top': anchor.y }, content)
      : null,
}));

vi.mock('@tabler/icons-react', () => ({
  IconSparkles: () => React.createElement('svg'),
}));

vi.mock('./MindroomThreadSummaryMarker.css', () => ({
  Marker: 'Marker',
  MarkerTrigger: 'MarkerTrigger',
  MarkerDetails: 'MarkerDetails',
}));

const text = (value: ReactTestInstance | string): string =>
  typeof value === 'string'
    ? value
    : value.children.map((child) => text(child as ReactTestInstance | string)).join('');

const summaryInfo = { summaryText: 'Fixing token refresh', messageCount: 21 };
const triggerRect = { x: 10, y: 20, width: 100, height: 16 };
const renderers: ReactTestRenderer[] = [];
const render = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element, {
      createNodeMock: () => ({
        getBoundingClientRect: () => ({ ...triggerRect }),
        contains: () => false,
      }),
    });
  });
  renderers.push(renderer);
  return renderer;
};
const trigger = (renderer: ReactTestRenderer) => renderer.root.findByType('button');
const popout = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-popout'] === true);

afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
});

describe('MindroomThreadSummaryMarker', () => {
  it('says the AI titled the thread for its first summary', () => {
    const renderer = render(
      <MindroomThreadSummaryMarker summaryInfo={summaryInfo} plan={{ first: true }} />
    );

    expect(text(trigger(renderer))).toBe('AI titled this thread');
  });

  it('says the AI updated the title for a later summary', () => {
    const renderer = render(
      <MindroomThreadSummaryMarker summaryInfo={summaryInfo} plan={{ first: false }} />
    );

    expect(text(trigger(renderer))).toBe('AI title updated');
  });

  it('says the title was edited for a manual summary', () => {
    const renderer = render(
      <MindroomThreadSummaryMarker
        summaryInfo={{ ...summaryInfo, isManual: true }}
        plan={{ first: false }}
      />
    );

    expect(text(trigger(renderer))).toBe('Title edited');
  });

  it('keeps the full title out of view until opened', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    expect(text(trigger(renderer))).toBe('AI title updated');
    expect(popout(renderer)).toHaveLength(0);
    expect(trigger(renderer).props['aria-expanded']).toBe(false);
  });

  it('shows the new title, its provenance and the old title when tapped', () => {
    const renderer = render(
      <MindroomThreadSummaryMarker
        summaryInfo={summaryInfo}
        plan={{ first: false, previousSummaryText: 'Push bug' }}
      />
    );

    act(() => trigger(renderer).props.onClick());

    const details = text(popout(renderer)[0]);
    expect(details).toContain('AI summary of last 21 messages');
    expect(details).toContain('Fixing token refresh');
    expect(details).toContain('Was: Push bug');
    expect(trigger(renderer).props['aria-expanded']).toBe(true);

    act(() => trigger(renderer).props.onClick());
    expect(popout(renderer)).toHaveLength(0);
  });

  it('lets the pointer through to the marker and timeline while open', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onClick());

    // folds' PopOut layer covers the screen; a tooltip must not take input.
    const [layer] = popout(renderer);
    expect(layer.props.role).toBe('tooltip');
    expect(layer.props.style).toEqual({ pointerEvents: 'none' });
  });

  it('opens while a mouse hovers and closes when it leaves', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'mouse' }));
    expect(popout(renderer)).toHaveLength(1);

    act(() => trigger(renderer).props.onPointerLeave({ pointerType: 'mouse' }));
    expect(popout(renderer)).toHaveLength(0);
  });

  it('does not open from a touch pointer entering, only from the tap', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onPointerEnter({ pointerType: 'touch' }));
    expect(popout(renderer)).toHaveLength(0);
  });

  it('closes on Escape and on a tap elsewhere', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onClick());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(popout(renderer)).toHaveLength(0);

    act(() => trigger(renderer).props.onClick());
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(popout(renderer)).toHaveLength(0);
  });

  it('closes when keyboard focus moves on', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onClick());
    act(() => trigger(renderer).props.onBlur());

    expect(popout(renderer)).toHaveLength(0);
  });

  it('stays open and follows the marker when the timeline scrolls', () => {
    const renderer = render(<MindroomThreadSummaryMarker summaryInfo={summaryInfo} />);

    act(() => trigger(renderer).props.onClick());
    expect(popout(renderer)[0].props['data-top']).toBe(20);
    triggerRect.y = 140;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(popout(renderer)).toHaveLength(1);
    expect(popout(renderer)[0].props['data-top']).toBe(140);
    triggerRect.y = 20;
  });

  it('describes the marker with the full title for screen readers', () => {
    const renderer = render(
      <MindroomThreadSummaryMarker
        summaryInfo={summaryInfo}
        plan={{ first: false, previousSummaryText: 'Push bug' }}
      />
    );

    const describedBy = trigger(renderer).props['aria-describedby'];
    const description = renderer.root.find((node) => node.props.id === describedBy);
    expect(text(description)).toContain('Fixing token refresh');
    expect(text(description)).toContain('Was: Push bug');
  });
});
