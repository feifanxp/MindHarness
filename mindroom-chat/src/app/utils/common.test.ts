import { describe, expect, it } from 'vitest';
import { secondsToMinutesAndSeconds } from './common';

describe('secondsToMinutesAndSeconds', () => {
  it('floors fractional seconds at minute boundaries', () => {
    expect(secondsToMinutesAndSeconds(59.6)).toBe('0:59');
    expect(secondsToMinutesAndSeconds(119.6)).toBe('1:59');
  });
});
