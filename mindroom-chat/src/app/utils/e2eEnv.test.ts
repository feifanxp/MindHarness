import { describe, expect, it } from 'vitest';
import { getHomeserver } from '../../../e2e/env';

describe('E2E homeserver defaults', () => {
  it('defaults to the MindRoom homeserver from the fork-owned runtime config', () => {
    const originalHomeserver = process.env.E2E_HOMESERVER;
    delete process.env.E2E_HOMESERVER;

    try {
      expect(getHomeserver()).toBe('mindroom.chat');
    } finally {
      if (originalHomeserver === undefined) {
        delete process.env.E2E_HOMESERVER;
      } else {
        process.env.E2E_HOMESERVER = originalHomeserver;
      }
    }
  });
});
