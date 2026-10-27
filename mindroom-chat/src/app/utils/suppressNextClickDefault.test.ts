// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { suppressNextClickDefault } from './suppressNextClickDefault';

describe('suppressNextClickDefault', () => {
  it('prevents the next click default action and then removes itself', () => {
    suppressNextClickDefault(document);

    const firstClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.dispatchEvent(firstClick);
    expect(firstClick.defaultPrevented).toBe(true);

    const secondClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.dispatchEvent(secondClick);
    expect(secondClick.defaultPrevented).toBe(false);
  });

  it('clears itself if no click arrives during the suppression window', () => {
    vi.useFakeTimers();
    try {
      suppressNextClickDefault(document);
      vi.runAllTimers();

      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports explicit cleanup', () => {
    const cleanup = suppressNextClickDefault(document);
    cleanup();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });
});
