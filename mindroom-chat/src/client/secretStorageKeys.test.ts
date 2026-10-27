import { beforeEach, describe, expect, it } from 'vitest';
import { clearSecretStorageKeys, cryptoCallbacks, storePrivateKey } from './secretStorageKeys';

describe('secret storage key cache', () => {
  beforeEach(() => {
    clearSecretStorageKeys();
  });

  it('does not return private key material after an account boundary clears it', async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    storePrivateKey('shared-key-id', privateKey);

    await expect(
      cryptoCallbacks.getSecretStorageKey({ keys: { 'shared-key-id': {} } })
    ).resolves.toEqual(['shared-key-id', privateKey]);

    clearSecretStorageKeys();

    await expect(
      cryptoCallbacks.getSecretStorageKey({ keys: { 'shared-key-id': {} } })
    ).resolves.toBeUndefined();
  });
});
