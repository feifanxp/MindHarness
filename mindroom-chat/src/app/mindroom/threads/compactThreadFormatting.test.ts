import { describe, expect, it, vi } from 'vitest';
import {
  formatCompactThreadMessageCount,
  getCompactThreadMessageCountLabel,
} from './compactThreadCardViewModel';

describe('compact thread count formatting under streaming refreshes', () => {
  it('reuses the current locale formatter across changing counts and follows language changes', () => {
    const constructor = vi.spyOn(Intl, 'NumberFormat');
    try {
      expect(getCompactThreadMessageCountLabel(1234, undefined, 'en-US')).toBe('1,234 msgs');
      expect(getCompactThreadMessageCountLabel(5678, undefined, 'en-US')).toBe('5,678 msgs');
      expect(constructor).toHaveBeenCalledTimes(1);
      expect(getCompactThreadMessageCountLabel(1234, undefined, 'de-DE')).toBe('1.234 msgs');
      expect(getCompactThreadMessageCountLabel(5678, undefined, 'de-DE')).toBe('5.678 msgs');
      expect(constructor).toHaveBeenCalledTimes(2);
      expect(getCompactThreadMessageCountLabel(1, undefined, 'en-US')).toBe('1 msg');
      expect(getCompactThreadMessageCountLabel(0, undefined, 'en-US')).toBe('0 replies');
      expect(formatCompactThreadMessageCount(1234, 'en-US')).toBe('1,234');
      expect(formatCompactThreadMessageCount(0, 'en-US')).toBe('0');
    } finally {
      constructor.mockRestore();
    }
  });
});
