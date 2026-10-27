import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Browser page translation crashes React renders, so the shell opts out of it.
// index.html is edited often for the theme bootstrap; keep both markers pinned.
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('index.html translation opt-out', () => {
  it('sets translate="no" on the root element', () => {
    expect(indexHtml).toMatch(/<html\b[^>]*\btranslate="no"/);
  });

  it('has the Google notranslate meta tag', () => {
    expect(indexHtml).toMatch(
      /<meta\b(?=[^>]*\bname="google")(?=[^>]*\bcontent="notranslate")[^>]*>/
    );
  });
});
