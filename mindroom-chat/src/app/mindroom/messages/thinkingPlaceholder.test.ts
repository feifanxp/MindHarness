import { describe, expect, it } from 'vitest';
import { isMindroomThinkingPlaceholderBody } from './thinkingPlaceholder';

describe('isMindroomThinkingPlaceholderBody', () => {
  it('matches only the exact MindRoom thinking placeholder body', () => {
    expect(isMindroomThinkingPlaceholderBody({ body: 'Thinking...' })).toBe(true);
    expect(isMindroomThinkingPlaceholderBody({ body: 'Thinking' })).toBe(false);
    expect(isMindroomThinkingPlaceholderBody({ body: ' Thinking...' })).toBe(false);
    expect(isMindroomThinkingPlaceholderBody({ body: 'Thinking...\n' })).toBe(false);
  });

  it('uses m.new_content body when an edit wrapper is present', () => {
    expect(
      isMindroomThinkingPlaceholderBody({
        body: 'old text',
        'm.new_content': {
          body: 'Thinking...',
        },
      })
    ).toBe(true);

    expect(
      isMindroomThinkingPlaceholderBody({
        body: 'Thinking...',
        'm.new_content': {
          body: 'real answer',
        },
      })
    ).toBe(false);
  });
});
