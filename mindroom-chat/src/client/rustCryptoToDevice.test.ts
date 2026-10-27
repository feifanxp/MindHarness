import * as RustSdkCryptoJs from '@matrix-org/matrix-sdk-crypto-wasm';
import { RustCrypto } from 'matrix-js-sdk/lib/rust-crypto/rust-crypto';
import { describe, expect, it, vi } from 'vitest';

describe('Rust crypto to-device preprocessing', () => {
  it('returns processed messages when a later store read fails', async () => {
    const bundle = {
      type: 'm.room_key_bundle',
      sender: '@agent:example',
      content: { room_id: '!room:example' },
    };
    const decrypted = {
      type: RustSdkCryptoJs.ProcessedToDeviceEventType.Decrypted,
      rawEvent: JSON.stringify(bundle),
      encryptionInfo: {
        sender: '@agent:example',
        senderDevice: 'AGENT',
        senderCurve25519Key: 'key',
        isSenderVerified: () => false,
      },
    };
    const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    // Only the members the method reads; the store is gone after receiveSyncChanges succeeded.
    const crypto = {
      logger,
      receiveSyncChanges: vi.fn(async () => [decrypted]),
      onIncomingKeyVerificationRequest: vi.fn(),
      maybeAcceptKeyBundle: vi.fn(),
      olmMachine: {
        getPendingKeyBundleDetailsForRoom: vi.fn(async () => {
          throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
        }),
      },
    };

    const received = await RustCrypto.prototype.preprocessToDeviceMessages.call(
      crypto as unknown as RustCrypto,
      [bundle]
    );

    // Failing here would make /sync feed the consumed messages to the crypto layer again.
    expect(received).toEqual([
      expect.objectContaining({ message: bundle, encryptionInfo: expect.anything() }),
    ]);
    expect(crypto.maybeAcceptKeyBundle).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
