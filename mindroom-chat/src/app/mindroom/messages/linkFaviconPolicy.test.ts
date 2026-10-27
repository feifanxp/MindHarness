import { describe, expect, it } from 'vitest';
import { shouldShowLinkFavicons } from './linkFaviconPolicy';

describe('shared link favicon settings', () => {
  it.each([
    { mediaAutoLoad: false, urlPreview: true, encUrlPreview: true, encrypted: false, want: false },
    { mediaAutoLoad: false, urlPreview: true, encUrlPreview: true, encrypted: true, want: false },
    { mediaAutoLoad: true, urlPreview: false, encUrlPreview: true, encrypted: false, want: false },
    { mediaAutoLoad: true, urlPreview: true, encUrlPreview: false, encrypted: false, want: true },
    { mediaAutoLoad: true, urlPreview: true, encUrlPreview: false, encrypted: true, want: false },
    { mediaAutoLoad: true, urlPreview: false, encUrlPreview: true, encrypted: true, want: true },
    {
      mediaAutoLoad: undefined,
      urlPreview: true,
      encUrlPreview: true,
      encrypted: false,
      want: false,
    },
    {
      mediaAutoLoad: true,
      urlPreview: undefined,
      encUrlPreview: undefined,
      encrypted: true,
      want: false,
    },
  ])('applies the room-specific policy: %j', ({ encrypted, want, ...settings }) => {
    expect(shouldShowLinkFavicons(settings, encrypted)).toBe(want);
  });
});
