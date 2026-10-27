import { describe, expect, it } from 'vitest';
import { shouldUseMindroomLightweightSearchResultBody } from './searchResultPolicy';

describe('shouldUseMindroomLightweightSearchResultBody', () => {
  it('uses the lightweight search renderer for MindRoom long-text metadata', () => {
    expect(
      shouldUseMindroomLightweightSearchResultBody({
        body: 'short preview',
        'io.mindroom.long_text': {
          version: 2,
        },
      })
    ).toBe(true);
  });

  it('does not force lightweight rendering for ordinary message content', () => {
    expect(
      shouldUseMindroomLightweightSearchResultBody({
        body: 'short preview',
      })
    ).toBe(false);
  });
});
