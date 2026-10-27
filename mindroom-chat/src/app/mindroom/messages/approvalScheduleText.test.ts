import { describe, expect, it } from 'vitest';
import { formatExpiryDistance } from './approvalScheduleText';

describe('formatExpiryDistance', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  it('describes how long until a request expires', () => {
    expect(formatExpiryDistance('2026-10-13T12:00:00Z', now, 'en')).toBe('in 24 hours');
    expect(formatExpiryDistance('2026-10-12T12:20:00Z', now, 'en')).toBe('in 20 minutes');
    expect(formatExpiryDistance('2026-10-15T12:00:00Z', now, 'en')).toBe('in 3 days');
  });
  it('returns undefined for unparseable or past timestamps', () => {
    expect(formatExpiryDistance('soon', now, 'en')).toBeUndefined();
    expect(formatExpiryDistance('2026-10-12T11:00:00Z', now, 'en')).toBeUndefined();
  });
});
