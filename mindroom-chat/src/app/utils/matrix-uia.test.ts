import { describe, expect, it } from 'vitest';
import { AuthType } from 'matrix-js-sdk';
import { getLoginTermUrl } from './matrix-uia';

// eslint-disable-next-line no-script-url -- a URL that must not be linked
const scriptUrl = 'javascript:alert(1)';

const termsParams = (privacyPolicy: Record<string, unknown>) => ({
  [AuthType.Terms]: { policies: { privacy_policy: privacyPolicy } },
});

describe('getLoginTermUrl', () => {
  it('returns an https terms URL', () => {
    expect(getLoginTermUrl(termsParams({ en: { url: 'https://example.org/terms' } }))).toBe(
      'https://example.org/terms'
    );
  });

  it('returns no URL for a javascript: terms URL', () => {
    expect(getLoginTermUrl(termsParams({ en: { url: scriptUrl } }))).toBeUndefined();
  });

  it('returns no URL for a javascript: terms URL in another language', () => {
    expect(getLoginTermUrl(termsParams({ de: { url: scriptUrl } }))).toBeUndefined();
  });
});
