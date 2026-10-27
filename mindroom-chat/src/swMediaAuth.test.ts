import { describe, expect, it } from 'vitest';
import { looksLikeMediaRequest, validMediaRequest } from './swMediaAuth';

describe('validMediaRequest', () => {
  it('requires the configured homeserver subpath', () => {
    expect(
      validMediaRequest(
        'https://example.com/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com/mindroom'
      )
    ).toBe(false);
    expect(
      validMediaRequest(
        'https://example.com/mindroom/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com/mindroom'
      )
    ).toBe(true);
  });

  it('rejects arbitrary prefixes for a root homeserver', () => {
    expect(
      validMediaRequest(
        'https://example.com/mindroom/_matrix/client/v1/media/thumbnail/server/mediaId',
        'https://example.com'
      )
    ).toBe(false);
  });

  it('rejects cross-origin media URLs', () => {
    expect(
      validMediaRequest(
        'https://evil.example/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com/mindroom'
      )
    ).toBe(false);
  });

  it('rejects endpoint prefix collisions', () => {
    const nearMisses = [
      'https://example.com/_matrix/client/v1/media/download-evil/server/mediaId',
      'https://example.com/_matrix/client/v1/media/thumbnailPreview/server/mediaId',
    ];

    for (const url of nearMisses) {
      expect(looksLikeMediaRequest(url)).toBe(false);
      expect(validMediaRequest(url, 'https://example.com')).toBe(false);
    }
  });

  it('accepts exact endpoint path boundaries', () => {
    expect(looksLikeMediaRequest('https://example.com/_matrix/client/v1/media/download')).toBe(
      true
    );
    expect(
      validMediaRequest(
        'https://example.com/_matrix/client/v1/media/download/server/mediaId',
        'https://example.com'
      )
    ).toBe(true);
  });
});
