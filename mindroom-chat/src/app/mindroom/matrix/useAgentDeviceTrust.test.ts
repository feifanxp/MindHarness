import { afterEach, describe, expect, it, vi } from 'vitest';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import {
  allDevicesSignedByOwner,
  collectAgentDeviceSignatures,
  getOrFetchAgentTrust,
  invalidateAgentDeviceTrust,
  scheduleAgentDeviceTrustRefresh,
} from './useAgentDeviceTrust';

const cryptoWithDevices = (
  userId: string,
  devices: Record<string, Record<string, unknown> | null>
): CryptoApi => {
  const deviceMap = new Map<string, Map<string, unknown>>([
    [userId, new Map(Object.keys(devices).map((deviceId) => [deviceId, {}]))],
  ]);
  return {
    getUserDeviceInfo: vi.fn(async () => deviceMap),
    getDeviceVerificationStatus: vi.fn(async (u: string, d: string) => devices[d]),
  } as unknown as CryptoApi;
};

describe('allDevicesSignedByOwner', () => {
  it('is true only when the list is non-empty and every device is signed', () => {
    expect(allDevicesSignedByOwner([true])).toBe(true);
    expect(allDevicesSignedByOwner([true, true])).toBe(true);
  });

  it('is false when any device is not signed (including a leaked rogue second device)', () => {
    expect(allDevicesSignedByOwner([true, false])).toBe(false);
    expect(allDevicesSignedByOwner([false, true])).toBe(false);
    expect(allDevicesSignedByOwner([false])).toBe(false);
  });

  it('treats an unreportable status (null) as not signed — fail safe', () => {
    expect(allDevicesSignedByOwner([null])).toBe(false);
    expect(allDevicesSignedByOwner([true, null])).toBe(false);
    expect(allDevicesSignedByOwner([null, true])).toBe(false);
  });

  it('is false when the user has no devices', () => {
    expect(allDevicesSignedByOwner([])).toBe(false);
  });
});

describe('collectAgentDeviceSignatures', () => {
  it('selects signedByOwner (not crossSigningVerified) — pinning the field choice', async () => {
    // A swap to `crossSigningVerified` would type-check and pass a classifier-
    // only suite while silently making the badge never show for bots the local
    // user has not verified. This test proves the pipeline reads the right
    // field: signedByOwner=true (bot bootstrapped cross-signing) counts as
    // signed even when crossSigningVerified=false (local user did no SAS).
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: { signedByOwner: true, crossSigningVerified: false },
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([true]);
  });

  it('downloads device keys for agents the viewer shares no encrypted room with', async () => {
    // Without downloadUncached the SDK omits untracked users entirely, so an
    // agent that only shares unencrypted rooms with the viewer would report no
    // devices and never show the badge.
    const userId = '@mindroom_code:example.org';
    const crypto = {
      // Like the SDK, an untracked user appears only when downloadUncached is set.
      getUserDeviceInfo: vi.fn(async (_users: string[], downloadUncached?: boolean) =>
        downloadUncached ? new Map([[userId, new Map([['DEV1', {}]])]]) : new Map()
      ),
      getDeviceVerificationStatus: vi.fn(async () => ({ signedByOwner: true })),
    } as unknown as CryptoApi;

    const statuses = await collectAgentDeviceSignatures(crypto, userId);

    expect(statuses).toEqual([true]);
    expect(crypto.getUserDeviceInfo).toHaveBeenCalledWith([userId], true);
  });

  it('returns each device status independently, in device-id order', async () => {
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: { signedByOwner: true, crossSigningVerified: false },
      DEV2: { signedByOwner: false, crossSigningVerified: true },
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([true, false]);
  });

  it('reports null for devices with no verification status', async () => {
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: null,
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([null]);
  });

  it('returns an empty list when the user has no devices', async () => {
    const crypto = {
      getUserDeviceInfo: vi.fn(async () => new Map()),
      getDeviceVerificationStatus: vi.fn(),
    } as unknown as CryptoApi;

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([]);
  });

  it('propagates crypto errors so the caller can fail safe', async () => {
    const crypto = {
      getUserDeviceInfo: vi.fn(async () => {
        throw new Error('crypto down');
      }),
      getDeviceVerificationStatus: vi.fn(),
    } as unknown as CryptoApi;

    await expect(
      collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org')
    ).rejects.toThrow('crypto down');
  });
});

describe('getOrFetchAgentTrust cache', () => {
  const userId = '@mindroom_code:example.org';
  const crypto = {} as CryptoApi;

  afterEach(() => {
    invalidateAgentDeviceTrust(crypto, userId);
    invalidateAgentDeviceTrust(crypto, '@mindroom_other:example.org');
  });

  it('runs the fetcher once for concurrent lookups of the same userId', async () => {
    const fetcher = vi.fn(async () => true);

    const [a, b] = await Promise.all([
      getOrFetchAgentTrust(crypto, userId, fetcher),
      getOrFetchAgentTrust(crypto, userId, fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it('serves subsequent lookups from the resolved cache without re-fetching', async () => {
    const fetcher = vi.fn(async () => true);

    await getOrFetchAgentTrust(crypto, userId, fetcher);
    await getOrFetchAgentTrust(crypto, userId, fetcher);
    await getOrFetchAgentTrust(crypto, userId, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after invalidateAgentDeviceTrust drops the entry', async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);

    expect(await getOrFetchAgentTrust(crypto, userId, first)).toBe(false);
    invalidateAgentDeviceTrust(crypto, userId);
    expect(await getOrFetchAgentTrust(crypto, userId, second)).toBe(true);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not commit a stale result when invalidation lands mid-flight', async () => {
    // Simulate a slow first fetch that finishes AFTER an invalidation.
    let resolveFirst: (value: boolean) => void = () => {};
    const firstPromise = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const first = vi.fn(() => firstPromise);
    const second = vi.fn(async () => false);

    const inFlight = getOrFetchAgentTrust(crypto, userId, first);
    invalidateAgentDeviceTrust(crypto, userId);
    // A fresh caller must NOT see the stale in-flight promise from the cache.
    const freshValue = await getOrFetchAgentTrust(crypto, userId, second);
    resolveFirst(true);
    await inFlight;

    expect(second).toHaveBeenCalledTimes(1);
    expect(freshValue).toBe(false);
    // The cache should hold the fresh result, not the stale one.
    const cached = await getOrFetchAgentTrust(crypto, userId, async () => true);
    expect(cached).toBe(false);
  });

  it('drops the entry on fetch error so retries do not lock into a failure', async () => {
    const failing = vi.fn(async () => {
      throw new Error('crypto down');
    });
    await expect(getOrFetchAgentTrust(crypto, userId, failing)).rejects.toThrow('crypto down');

    const retry = vi.fn(async () => true);
    expect(await getOrFetchAgentTrust(crypto, userId, retry)).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('scopes the cache per userId', async () => {
    const fetchAlice = vi.fn(async () => true);
    const fetchBob = vi.fn(async () => false);

    expect(await getOrFetchAgentTrust(crypto, userId, fetchAlice)).toBe(true);
    expect(await getOrFetchAgentTrust(crypto, '@mindroom_other:example.org', fetchBob)).toBe(false);

    expect(fetchAlice).toHaveBeenCalledTimes(1);
    expect(fetchBob).toHaveBeenCalledTimes(1);
  });

  it('does not reuse trust across Matrix crypto sessions', async () => {
    const otherCrypto = {} as CryptoApi;
    const firstSession = vi.fn(async () => true);
    const secondSession = vi.fn(async () => false);

    expect(await getOrFetchAgentTrust(crypto, userId, firstSession)).toBe(true);
    expect(await getOrFetchAgentTrust(otherCrypto, userId, secondSession)).toBe(false);

    expect(firstSession).toHaveBeenCalledTimes(1);
    expect(secondSession).toHaveBeenCalledTimes(1);
  });
});

describe('device-update refresh scheduling', () => {
  it('coalesces sibling badge refreshes onto one fresh crypto lookup', async () => {
    const userId = '@mindroom_code:example.org';
    const crypto = {} as CryptoApi;
    const fetcher = vi.fn(async () => true);
    const values: boolean[] = [];
    const refreshA = () => {
      void getOrFetchAgentTrust(crypto, userId, fetcher).then((value) => values.push(value));
    };
    const refreshB = () => {
      void getOrFetchAgentTrust(crypto, userId, fetcher).then((value) => values.push(value));
    };

    // Warm the cache, then simulate the synchronous listener fan-out from two
    // mounted badges for one DevicesUpdated event.
    await getOrFetchAgentTrust(crypto, userId, fetcher);
    scheduleAgentDeviceTrustRefresh(crypto, userId, refreshA);
    scheduleAgentDeviceTrustRefresh(crypto, userId, refreshB);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(values).toEqual([true, true]);
    invalidateAgentDeviceTrust(crypto, userId);
  });

  it('invalidates an in-flight refresh before scheduling the next generation', async () => {
    const userId = '@mindroom_code:example.org';
    const crypto = {} as CryptoApi;
    let resolveFirst: (value: boolean) => void = () => undefined;
    const first = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const second = vi.fn(async () => false);
    let fetcher = first;
    const values: boolean[] = [];
    const refresh = () => {
      void getOrFetchAgentTrust(crypto, userId, fetcher).then((value) => values.push(value));
    };

    scheduleAgentDeviceTrustRefresh(crypto, userId, refresh);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(first).toHaveBeenCalledTimes(1);

    fetcher = second;
    scheduleAgentDeviceTrustRefresh(crypto, userId, refresh);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    await Promise.resolve();
    resolveFirst(true);
    await Promise.resolve();

    expect(second).toHaveBeenCalledTimes(1);
    expect(await getOrFetchAgentTrust(crypto, userId, async () => true)).toBe(false);
    expect(values).toEqual([false, true]);
    invalidateAgentDeviceTrust(crypto, userId);
  });
});
