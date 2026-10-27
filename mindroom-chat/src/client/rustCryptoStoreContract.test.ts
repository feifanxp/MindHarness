// @vitest-environment node

import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { StoreHandle, initAsync } from '@matrix-org/matrix-sdk-crypto-wasm';

describe('matrix-sdk-crypto-wasm IndexedDB contract', () => {
  beforeAll(async () => {
    await initAsync();
  });

  it('creates only the main database when MindRoom Chat opens a passwordless store', async () => {
    const prefix = 'mindroom-crypto-contract';

    const handle = await StoreHandle.open(prefix, undefined);

    try {
      await expect(indexedDB.databases()).resolves.toEqual([
        {
          name: `${prefix}::matrix-sdk-crypto`,
          version: expect.any(Number),
        },
      ]);
    } finally {
      handle.free();
    }
  });
});
