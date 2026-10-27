import { DeviceId, EncryptionAlgorithm, UserId } from '@matrix-org/matrix-sdk-crypto-wasm';
import { logger } from 'matrix-js-sdk/lib/logger';
import { RustCrypto } from 'matrix-js-sdk/lib/rust-crypto/rust-crypto';
import { describe, expect, it, vi } from 'vitest';

const USER_ID = '@agent:example.org';
const DEVICE_ID = 'DEVICE';
const VALIDATED_IDENTITY_KEY = 'validated-curve-key';
const RAW_IDENTITY_KEY = 'raw-untrusted-curve-key';

type RustUserId = InstanceType<typeof UserId>;

const rawDeviceQueryResponse = {
  device_keys: {
    [USER_ID]: {
      [DEVICE_ID]: {
        algorithms: ['m.olm.v1.curve25519-aes-sha2'],
        device_id: DEVICE_ID,
        keys: {
          [`curve25519:${DEVICE_ID}`]: RAW_IDENTITY_KEY,
          [`ed25519:${DEVICE_ID}`]: 'raw-untrusted-signing-key',
        },
        signatures: {
          [USER_ID]: {
            [`ed25519:${DEVICE_ID}`]: 'raw-untrusted-signature',
          },
        },
        user_id: USER_ID,
      },
    },
  },
  failures: {},
};

const makeRustDevice = (localTrustWrites: { count: number }) => ({
  algorithms: [EncryptionAlgorithm.OlmV1Curve25519AesSha2],
  deviceId: new DeviceId(DEVICE_ID),
  displayName: 'Validated device',
  encryptToDeviceEvent: vi.fn(async () =>
    JSON.stringify({
      algorithm: 'm.olm.v1.curve25519-aes-sha2',
      ciphertext: 'validated-ciphertext',
    })
  ),
  free: vi.fn(),
  isBlacklisted: () => false,
  isCrossSignedByOwner: () => true,
  isCrossSigningTrusted: () => false,
  isDehydrated: false,
  isLocallyTrusted: () => false,
  isVerified: () => false,
  keys: new Map([
    [{ toString: () => `curve25519:${DEVICE_ID}` }, { toBase64: () => VALIDATED_IDENTITY_KEY }],
    [{ toString: () => `ed25519:${DEVICE_ID}` }, { toBase64: () => 'validated-signing-key' }],
  ]),
  setLocalTrust: vi.fn(() => {
    localTrustWrites.count += 1;
  }),
  signatures: { get: () => new Map() },
});

const makeCryptoHarness = ({
  initiallyTracked = false,
  initiallyPopulated = false,
  failedQueries = 0,
}: {
  initiallyTracked?: boolean;
  initiallyPopulated?: boolean;
  failedQueries?: number;
} = {}) => {
  const trackedUsers = new Set(initiallyTracked ? [USER_ID] : []);
  const populatedUsers = new Set(initiallyPopulated ? [USER_ID] : []);
  const pendingQueries = new Set<string>();
  const localTrustWrites = { count: 0 };
  let remainingFailedQueries = failedQueries;

  const updateTrackedUsers = vi.fn(async (userIds: RustUserId[]) => {
    userIds.forEach((userId) => {
      const id = userId.toString();
      trackedUsers.add(id);
      pendingQueries.add(id);
      userId.free();
    });
  });
  const processOutgoingRequests = vi.fn(async () => {
    if (remainingFailedQueries > 0) {
      remainingFailedQueries -= 1;
      return;
    }
    pendingQueries.forEach((userId) => populatedUsers.add(userId));
    pendingQueries.clear();
  });
  const rawHttpRequest = vi.fn(async () => rawDeviceQueryResponse);
  const getUserDevices = vi.fn(async (userId: RustUserId) => ({
    devices: () =>
      populatedUsers.has(userId.toString()) ? [makeRustDevice(localTrustWrites)] : [],
    free: vi.fn(),
  }));
  const getDevice = vi.fn(async (userId: RustUserId, deviceId: DeviceId) =>
    populatedUsers.has(userId.toString()) && deviceId.toString() === DEVICE_ID
      ? makeRustDevice(localTrustWrites)
      : undefined
  );

  const crypto = Object.assign(Object.create(RustCrypto.prototype) as object, {
    _trustCrossSignedDevices: true,
    http: { authedRequest: rawHttpRequest },
    keyClaimManager: { ensureSessionsForUsers: vi.fn(async () => undefined) },
    logger,
    olmMachine: {
      getDevice,
      getUserDevices,
      trackedUsers: vi.fn(
        async () =>
          new Set([...trackedUsers].map((userId) => ({ free: vi.fn(), toString: () => userId })))
      ),
      updateTrackedUsers,
    },
    outgoingRequestsManager: { doProcessOutgoingRequests: processOutgoingRequests },
    stopped: false,
  }) as RustCrypto;

  return {
    crypto,
    getDevice,
    localTrustWrites,
    processOutgoingRequests,
    rawHttpRequest,
    updateTrackedUsers,
  };
};

describe('matrix-js-sdk explicit device discovery', () => {
  it('hydrates an untracked user through the validated Rust store', async () => {
    const harness = makeCryptoHarness();

    const result = await harness.crypto.getUserDeviceInfo([USER_ID], true);

    expect(result.get(USER_ID)?.get(DEVICE_ID)?.getIdentityKey()).toBe(VALIDATED_IDENTITY_KEY);
    expect(harness.updateTrackedUsers).toHaveBeenCalledOnce();
    expect(harness.processOutgoingRequests).toHaveBeenCalledOnce();
    expect(harness.rawHttpRequest).not.toHaveBeenCalled();

    const verification = await harness.crypto.getDeviceVerificationStatus(USER_ID, DEVICE_ID);
    expect(verification?.signedByOwner).toBe(true);

    const encrypted = await harness.crypto.encryptToDeviceMessages(
      'io.example.catalog_request',
      [{ userId: USER_ID, deviceId: DEVICE_ID }],
      { request_id: 'request' }
    );
    expect(encrypted.batch).toEqual([
      {
        deviceId: DEVICE_ID,
        userId: USER_ID,
        payload: {
          algorithm: 'm.olm.v1.curve25519-aes-sha2',
          ciphertext: 'validated-ciphertext',
        },
      },
    ]);
    expect(harness.localTrustWrites.count).toBe(0);
  });

  it('does not begin tracking when downloadUncached uses its default', async () => {
    const harness = makeCryptoHarness();

    const result = await harness.crypto.getUserDeviceInfo([USER_ID]);

    expect(result.size).toBe(0);
    expect(harness.updateTrackedUsers).not.toHaveBeenCalled();
    expect(harness.processOutgoingRequests).not.toHaveBeenCalled();
    expect(harness.rawHttpRequest).not.toHaveBeenCalled();
  });

  it('reads populated tracked users without scheduling device queries', async () => {
    const harness = makeCryptoHarness({ initiallyPopulated: true, initiallyTracked: true });

    const result = await harness.crypto.getUserDeviceInfo([USER_ID], true);

    expect(result.get(USER_ID)?.get(DEVICE_ID)?.getIdentityKey()).toBe(VALIDATED_IDENTITY_KEY);
    expect(harness.updateTrackedUsers).not.toHaveBeenCalled();
    expect(harness.processOutgoingRequests).not.toHaveBeenCalled();
    expect(harness.rawHttpRequest).not.toHaveBeenCalled();
  });

  it('fails closed after a key-query failure and retries the pending query', async () => {
    const harness = makeCryptoHarness({ failedQueries: 1 });

    const failedResult = await harness.crypto.getUserDeviceInfo([USER_ID], true);

    expect(failedResult.get(USER_ID)?.size).toBe(0);
    expect(await harness.crypto.getDeviceVerificationStatus(USER_ID, DEVICE_ID)).toBeNull();
    expect(harness.rawHttpRequest).not.toHaveBeenCalled();

    const retryResult = await harness.crypto.getUserDeviceInfo([USER_ID], true);

    expect(retryResult.get(USER_ID)?.get(DEVICE_ID)?.getIdentityKey()).toBe(VALIDATED_IDENTITY_KEY);
    expect(harness.updateTrackedUsers).toHaveBeenCalledOnce();
    expect(harness.processOutgoingRequests).toHaveBeenCalledTimes(2);
  });
});
