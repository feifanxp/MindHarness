import { describe, expect, it } from 'vitest';
import { MINDROOM_SESSION_STORE_EVENT, MINDROOM_SESSION_STORE_KEY } from './sessionStoreConfig';

describe('sessionStoreConfig', () => {
  it('owns the persisted multi-account session store names', () => {
    expect(MINDROOM_SESSION_STORE_KEY).toBe('mindroom_multi_account_store');
    expect(MINDROOM_SESSION_STORE_EVENT).toBe('mindroom-session-store-changed');
  });
});
