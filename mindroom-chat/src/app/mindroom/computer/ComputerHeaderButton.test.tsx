import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ComputerHeaderButton } from './ComputerHeaderButton';

const buttonType = 'computer-button';

vi.mock('folds', () => ({
  Icon: 'span',
  IconButton: React.forwardRef<unknown, { children?: React.ReactNode }>(
    ({ children, ...props }, _ref) => React.createElement(buttonType, props, children)
  ),
  Icons: { Monitor: 'Monitor' },
  Text: 'span',
  Tooltip: ({ children }: { children?: React.ReactNode }) => children,
  TooltipProvider: ({
    children,
  }: {
    children: (ref: React.RefObject<HTMLElement>) => React.ReactNode;
  }) => children(React.createRef()),
}));

describe('ComputerHeaderButton', () => {
  it('is absent when the room is not eligible', () => {
    const renderer = create(
      <ComputerHeaderButton
        label="Toon computer"
        available={false}
        open={false}
        onToggle={() => undefined}
      />
    );

    expect(renderer.toJSON()).toBeNull();
  });

  it('opens the computer panel and exposes its current state', () => {
    const onToggle = vi.fn();
    const renderer = create(
      <ComputerHeaderButton label="Toon computer" available open={false} onToggle={onToggle} />
    );
    const button = renderer.root.findByType(buttonType as never);

    expect(button.props['aria-label']).toBe('Toon computer');
    expect(button.props['aria-pressed']).toBe(false);
    act(() => button.props.onClick());
    expect(onToggle).toHaveBeenCalledOnce();

    renderer.update(
      <ComputerHeaderButton label="Verberg computer" available open onToggle={onToggle} />
    );
    expect(renderer.root.findByType(buttonType as never).props['aria-label']).toBe(
      'Verberg computer'
    );
    expect(renderer.root.findByType(buttonType as never).props['aria-pressed']).toBe(true);
  });
});
