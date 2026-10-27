import * as rust from '@matrix-org/matrix-sdk-crypto-wasm';
import { createClient, Device } from 'matrix-js-sdk';
import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { KeyClaimManager } from 'matrix-js-sdk/lib/rust-crypto/KeyClaimManager';
import { RustCrypto } from 'matrix-js-sdk/lib/rust-crypto/rust-crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { signedModelDevices } from './modelDeviceTrust';
import { sendModelRequest } from './modelTransport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('delivers discovery to a healthy device when another signed device has no Olm session', async () => {
  await rust.initAsync();
  const userId = '@mindroom_router:example.org';
  const viewer = await rust.OlmMachine.initialize(
    new rust.UserId('@viewer:example.org'),
    new rust.DeviceId('VIEWER')
  );
  const healthy = await rust.OlmMachine.initialize(
    new rust.UserId(userId),
    new rust.DeviceId('HEALTHY')
  );
  const stale = await rust.OlmMachine.initialize(
    new rust.UserId(userId),
    new rust.DeviceId('STALE')
  );
  const controller = new AbortController();
  let sending: Promise<void> | undefined;
  try {
    const upload = async (machine: rust.OlmMachine) => {
      const request = (await machine.outgoingRequests())!.find(
        (item) => item.type === rust.RequestType.KeysUpload
      ) as rust.KeysUploadRequest;
      return JSON.parse(request.body);
    };
    const healthyKeys = await upload(healthy);
    const staleKeys = await upload(stale);
    await viewer.updateTrackedUsers([new rust.UserId(userId)]);
    const query = viewer.queryKeysForUsers([new rust.UserId(userId)]);
    await viewer.markRequestAsSent(
      query.id,
      query.type,
      JSON.stringify({
        device_keys: {
          [userId]: { HEALTHY: healthyKeys.device_keys, STALE: staleKeys.device_keys },
        },
        failures: {},
      })
    );
    const [keyName, keyValue] = Object.entries(healthyKeys.one_time_keys)[0];
    // Only the homeserver is simulated: old devices can exhaust their one-time keys.
    const keyClaimManager = new KeyClaimManager(viewer, {
      async makeOutgoingRequest(request: rust.KeysClaimRequest) {
        await viewer.markRequestAsSent(
          request.id,
          request.type,
          JSON.stringify({
            one_time_keys: { [userId]: { HEALTHY: { [keyName]: keyValue } } },
            failures: {},
          })
        );
      },
    } as ConstructorParameters<typeof KeyClaimManager>[1]);
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      getChild() {
        return this;
      },
    };
    const backing = { olmMachine: viewer, keyClaimManager, logger } as unknown as RustCrypto;
    const devices = new Map([
      [
        userId,
        new Map(
          [healthyKeys, staleKeys].map((keys) => [
            keys.device_keys.device_id,
            new Device({
              userId,
              deviceId: keys.device_keys.device_id,
              algorithms: keys.device_keys.algorithms,
              keys: new Map(Object.entries(keys.device_keys.keys) as [string, string][]),
            }),
          ])
        ),
      ],
    ]);
    const crypto = {
      getUserDeviceInfo: async () => devices,
      getDeviceVerificationStatus: async () => ({ signedByOwner: true }),
      encryptToDeviceMessages: RustCrypto.prototype.encryptToDeviceMessages.bind(backing),
    } as unknown as CryptoApi;
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@viewer:example.org',
      deviceId: 'VIEWER',
    });
    vi.spyOn(mx, 'getCrypto').mockReturnValue(crypto);
    const queued: Parameters<typeof mx.queueToDevice>[0][] = [];
    vi.spyOn(mx, 'queueToDevice').mockImplementation(async (batch) => {
      queued.push(batch);
    });
    const recipients = await signedModelDevices(mx, [userId]);
    expect(recipients).toHaveLength(2);
    vi.useFakeTimers();
    sending = sendModelRequest(
      mx,
      recipients,
      { version: 1, request_id: 'discovery' },
      controller.signal,
      () => false
    );
    await vi.advanceTimersByTimeAsync(1500);
    expect(queued.flatMap((batch) => batch.batch.map((recipient) => recipient.deviceId))).toEqual([
      'HEALTHY',
    ]);
    expect(queued[0].eventType).toBe('m.room.encrypted');
    expect(queued[0].batch[0].payload).toHaveProperty('ciphertext');
    expect(JSON.stringify(queued)).not.toContain('discovery');
  } finally {
    controller.abort();
    await sending;
    viewer.close();
    healthy.close();
    stale.close();
  }
});
