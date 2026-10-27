import 'fake-indexeddb/auto';
import {
  DeviceId,
  OlmMachine,
  RoomId,
  StoreHandle,
  UserId,
  initAsync,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { describe, expect, it, vi } from 'vitest';
import { RustCrypto } from 'matrix-js-sdk/lib/rust-crypto/rust-crypto';
import { getSessionRustCryptoStorePrefix } from '../app/state/sessions';
import { initClient } from './initMatrix';

describe('offline account startup with a pending room key bundle', () => {
  it.each(['success', 'offline'])(
    'opens the existing crypto store while the inviter lookup is pending, then %s',
    async (outcome) => {
      const session = {
        sessionId: `offline-invited-account-${outcome}`,
        baseUrl: 'https://matrix.example',
        userId: '@alice:example',
        deviceId: 'EXISTING',
        accessToken: 'test-token',
      };
      await initAsync();
      const store = await StoreHandle.open(getSessionRustCryptoStorePrefix(session), undefined);
      const machine = await OlmMachine.initFromStore(
        new UserId(session.userId),
        new DeviceId(session.deviceId),
        store
      );
      await machine.storeRoomPendingKeyBundle(
        new RoomId('!invited:example'),
        new UserId('@bob:example')
      );
      const identity = machine.identityKeys.ed25519.toBase64();
      machine.free();
      store.free();

      let release!: () => void;
      const network = new Promise<void>((resolve) => {
        release = resolve;
      });
      const request = vi.fn<typeof fetch>(async (input) => {
        if (!String(input).endsWith('/keys/query')) {
          return new Response(JSON.stringify({ errcode: 'M_NOT_FOUND' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await network;
        if (outcome === 'offline') throw new TypeError('Load failed');
        return new Response(JSON.stringify({ device_keys: {} }), {
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', request);
      // Observe the real background task so teardown can wait for it before freeing WASM.
      const acceptBundle = RustCrypto.prototype.maybeAcceptKeyBundle;
      const bundleTasks: Promise<boolean>[] = [];
      vi.spyOn(RustCrypto.prototype, 'maybeAcceptKeyBundle').mockImplementation(function accept(
        this: RustCrypto,
        ...args
      ) {
        const task = acceptBundle.apply(this, args);
        bundleTasks.push(task);
        return task;
      });
      let ready = false;
      const startup = initClient(session).then((client) => {
        ready = true;
        return client;
      });
      try {
        await vi.waitFor(() => expect(ready).toBe(true), { timeout: 1_000 });
        const client = await startup;
        expect(await client.getCrypto()?.getOwnDeviceKeys()).toMatchObject({ ed25519: identity });
        // Exhaust the real SDK's network retries without spending 30 seconds waiting.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        release();
        await vi.runAllTimersAsync();
        const results = await Promise.allSettled(bundleTasks);
        if (outcome === 'offline') {
          expect(results).toEqual([
            expect.objectContaining({
              status: 'rejected',
              reason: expect.objectContaining({ message: 'fetch failed: Load failed' }),
            }),
          ]);
        }
        expect(await client.getCrypto()?.getOwnDeviceKeys()).toMatchObject({ ed25519: identity });
        vi.useRealTimers();
      } finally {
        release();
        const client = await startup;
        await Promise.allSettled(bundleTasks);
        await client.getCrypto()?.checkKeyBackupAndEnable();
        client.stopClient();
        await client.store.destroy();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
      const reopenedStore = await StoreHandle.open(
        getSessionRustCryptoStorePrefix(session),
        undefined
      );
      const reopenedMachine = await OlmMachine.initFromStore(
        new UserId(session.userId),
        new DeviceId(session.deviceId),
        reopenedStore
      );
      try {
        const pending = await reopenedMachine.getPendingKeyBundleDetailsForRoom(
          new RoomId('!invited:example')
        );
        expect(pending?.inviterId.toString()).toBe('@bob:example');
        expect(reopenedMachine.identityKeys.ed25519.toBase64()).toBe(identity);
      } finally {
        reopenedMachine.free();
        reopenedStore.free();
      }
    }
  );
});
