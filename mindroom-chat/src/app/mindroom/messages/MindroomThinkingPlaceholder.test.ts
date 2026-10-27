import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import { MindroomThinkingPlaceholder } from './MindroomThinkingPlaceholder';
import thinkingMark from './thinking-mark.svg?raw';
import {
  DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES,
  resolveMindroomThinkingPlaceholderMessages,
} from './thinkingPlaceholder';

vi.mock('./MindroomThinkingPlaceholder.css', () => ({
  Aura: 'Aura',
  Core: 'Core',
  Indicator: 'Indicator',
  Mark: 'Mark',
  Placeholder: 'Placeholder',
  Rotor: 'Rotor',
  Text: 'Text',
  TextBase: 'TextBase',
  TextSweep: 'TextSweep',
  TextCounter: 'TextCounter',
  TextHighlight: 'TextHighlight',
}));

const renderPlaceholder = (messages?: string[]) =>
  create(
    React.createElement(
      ClientConfigProvider,
      {
        value: {
          mindroom: {
            thinkingPlaceholderMessages: messages,
          },
        },
      },
      React.createElement(MindroomThinkingPlaceholder)
    )
  );

describe('resolveMindroomThinkingPlaceholderMessages', () => {
  it('uses non-empty configured messages', () => {
    expect(
      resolveMindroomThinkingPlaceholderMessages([' Configured ', '', 'Also configured'])
    ).toEqual(['Configured', 'Also configured']);
  });

  it('falls back to built-in messages when config has no usable messages', () => {
    expect(resolveMindroomThinkingPlaceholderMessages(undefined)).toBe(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES
    );
    expect(resolveMindroomThinkingPlaceholderMessages(['', '   ', 42])).toBe(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES
    );
  });
});

describe('MindroomThinkingPlaceholder', () => {
  it('keeps the SVG artwork decorative inside the responding status', () => {
    const renderer = renderPlaceholder(['Working']);

    const status = renderer.root.findByProps({ role: 'status' });
    const indicator = status.findByProps({ className: 'Indicator' });

    expect(status.props['aria-label']).toBe('AI is responding');
    expect(indicator.props['aria-hidden']).toBe('true');
    const artwork = indicator.findAllByType('svg');
    expect(artwork).toHaveLength(2);
    artwork.forEach((svg) => expect(svg.props.focusable).toBe('false'));
    expect(JSON.stringify(renderer.toJSON())).toContain('Working');

    renderer.unmount();
  });

  it('renders configured placeholder messages and rotates through them', () => {
    vi.useFakeTimers();

    let renderer: ReturnType<typeof renderPlaceholder> | undefined;
    act(() => {
      renderer = renderPlaceholder(['Configured one', 'Configured two']);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured one');
    expect(JSON.stringify(renderer?.toJSON())).not.toContain('Making progress');

    act(() => {
      vi.advanceTimersByTime(3599);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured one');

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('Configured two');

    renderer?.unmount();
    vi.useRealTimers();
  });

  it('renders the built-in messages when config is empty', () => {
    const renderer = renderPlaceholder([]);

    expect(JSON.stringify(renderer.toJSON())).toContain(
      DEFAULT_MINDROOM_THINKING_PLACEHOLDER_MESSAGES[0]
    );

    renderer.unmount();
  });
});

describe('thinking mark artwork', () => {
  it('opens the frame behind the turning core', () => {
    // Copy MindRoom's assets/logo/logo-mark-movable-cube.svg; its logo-mark.svg keeps a solid frame that shows a navy slab behind the flip.
    const frame = thinkingMark.match(/<path id="structural-frame"[^>]*>/)?.[0] ?? '';
    expect(frame).toContain('fill-rule="evenodd"');
    expect(frame.match(/ Z/g)).toHaveLength(2);
  });
});
