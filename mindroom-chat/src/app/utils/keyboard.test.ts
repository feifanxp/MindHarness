import { describe, expect, it, vi } from 'vitest';
import { onTabPress } from './keyboard';

const keyEvent = (key: string) =>
  ({
    key,
    which: key === 'Tab' ? 9 : key === 'Enter' ? 13 : 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
  } as const);

describe('keyboard helpers', () => {
  it('runs autocomplete actions on Tab', () => {
    const event = keyEvent('Tab');
    const callback = vi.fn();

    onTabPress(event, callback);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('runs autocomplete actions on Enter', () => {
    const event = keyEvent('Enter');
    const callback = vi.fn();

    onTabPress(event, callback);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
