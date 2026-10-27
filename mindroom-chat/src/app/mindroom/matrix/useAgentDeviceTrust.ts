import { useCallback, useEffect, useRef, useState } from 'react';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { deviceSignedByOwner } from '../../utils/matrix-crypto';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useDeviceListChange } from '../../hooks/useDeviceList';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Pure classifier: a MindRoom agent presents a trustworthy device identity when
 * it has at least one device AND every device is signed by the account's own
 * self-signing key. `null` entries (crypto could not report a status) count as
 * NOT signed — fail-safe — so a rogue second device on a leaked-password
 * session cannot ride behind a green shield while MSC4153 key-sharing
 * exclusion is not yet active in this client (FORK_CHANGES.md D7.5).
 */
export const allDevicesSignedByOwner = (statuses: Array<boolean | null>): boolean =>
  statuses.length > 0 && statuses.every((status) => status === true);

/**
 * Enumerate a user's devices via the crypto API and return each device's
 * `signedByOwner` status (`null` when crypto cannot report). Exported so the
 * per-device field choice can be pinned in tests: a swap to
 * `crossSigningVerified` would type-check and slip through a classifier-only
 * suite while silently breaking the affordance for un-verified agents.
 */
export const collectAgentDeviceSignatures = async (
  crypto: CryptoApi,
  userId: string
): Promise<Array<boolean | null>> => {
  // Agents often share only unencrypted rooms with the viewer, so their device
  // lists are not tracked; download them instead of reporting no devices.
  const deviceMap = await crypto.getUserDeviceInfo([userId], true);
  const deviceIds = Array.from(deviceMap.get(userId)?.keys() ?? []);
  return Promise.all(deviceIds.map((deviceId) => deviceSignedByOwner(crypto, userId, deviceId)));
};

/**
 * Module-level trust cache shared across every mounted
 * `useAgentDeviceCrossSigned`, scoped first by CryptoApi and then agent user
 * ID. A member row and its profile card reuse the same in-flight promise,
 * while another account/client can never reuse that verdict. Invalidation on
 * `DevicesUpdated` still triggers a fresh fetch. A resolved value only commits
 * while the entry still points at the promise that produced it, so an
 * invalidation racing a fetch does not leak stale data.
 */
type CacheEntry = { value: boolean } | Promise<boolean>;
const agentTrustCache = new WeakMap<CryptoApi, Map<string, CacheEntry>>();
const scheduledTrustRefreshes = new WeakMap<CryptoApi, Map<string, Set<() => void>>>();

const getCryptoTrustCache = (crypto: CryptoApi): Map<string, CacheEntry> => {
  const existing = agentTrustCache.get(crypto);
  if (existing) return existing;

  const cache = new Map<string, CacheEntry>();
  agentTrustCache.set(crypto, cache);
  return cache;
};

const isPromise = (entry: CacheEntry): entry is Promise<boolean> => 'then' in entry;

/**
 * Drop the cached trust result for a userId so the next lookup re-fetches.
 * Exported for tests; the hook itself invalidates from its `DevicesUpdated`
 * listener before scheduling a re-fetch.
 */
export const invalidateAgentDeviceTrust = (crypto: CryptoApi, userId: string): void => {
  agentTrustCache.get(crypto)?.delete(userId);
};

/**
 * Device updates are emitted synchronously to every mounted badge. Invalidate
 * immediately, but defer the subscribers until all listeners have observed
 * the event. The first subscriber then installs one shared fetch promise and
 * every sibling coalesces onto it instead of deleting each other's request.
 */
export const scheduleAgentDeviceTrustRefresh = (
  crypto: CryptoApi,
  userId: string,
  refresh: () => void
): void => {
  invalidateAgentDeviceTrust(crypto, userId);
  let byUser = scheduledTrustRefreshes.get(crypto);
  if (!byUser) {
    byUser = new Map();
    scheduledTrustRefreshes.set(crypto, byUser);
  }
  const existing = byUser.get(userId);
  if (existing) {
    existing.add(refresh);
    return;
  }

  const subscribers = new Set([refresh]);
  byUser.set(userId, subscribers);
  queueMicrotask(() => {
    if (byUser?.get(userId) !== subscribers) return;
    byUser.delete(userId);
    subscribers.forEach((subscriber) => subscriber());
  });
};

export const getOrFetchAgentTrust = (
  crypto: CryptoApi,
  userId: string,
  fetcher: () => Promise<boolean>
): Promise<boolean> => {
  const cache = getCryptoTrustCache(crypto);
  const existing = cache.get(userId);
  if (existing) return isPromise(existing) ? existing : Promise.resolve(existing.value);

  const promise = fetcher().then(
    (value) => {
      // Only commit if invalidation (or a newer fetch) has not raced past us.
      if (cache.get(userId) === promise) cache.set(userId, { value });
      return value;
    },
    (error) => {
      if (cache.get(userId) === promise) cache.delete(userId);
      throw error;
    }
  );
  cache.set(userId, promise);
  return promise;
};

/**
 * Whether a MindRoom agent presents a cross-signed device identity.
 *
 * Returns true only for agent users on the viewer's own homeserver (per the
 * platform username convention plus a same-server check) whose devices are ALL
 * signed by the account's own self-signing key. This is the signal that
 * survives MSC4153 key-sharing: it does not require the local user to have
 * verified the agent (a deliberate non-goal), only that the agent bootstrapped
 * cross-signing (mindroom-nio D2). Non-agents, cross-homeserver users, agents
 * with any un-cross-signed device, and clients without crypto all resolve to
 * false.
 */
export const useAgentDeviceCrossSigned = (userId: string): boolean => {
  const mx = useMatrixClient();
  const crypto = mx.getCrypto();
  const alive = useAlive();
  const generationRef = useRef(0);
  const [trustState, setTrustState] = useState<{
    crypto?: CryptoApi;
    userId: string;
    value: boolean;
  }>({ userId, value: false });

  const update = useCallback(async () => {
    // Bump a generation per invocation so that when several device-list events
    // fire in quick succession, only the latest run's result is committed —
    // an earlier run resolving late must not overwrite a newer one.
    generationRef.current += 1;
    const generation = generationRef.current;
    const commit = (value: boolean) => {
      if (alive() && generation === generationRef.current) {
        setTrustState({ crypto, userId, value });
      }
    };

    if (!crypto || !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined)) {
      commit(false);
      return;
    }

    try {
      const trusted = await getOrFetchAgentTrust(crypto, userId, async () =>
        allDevicesSignedByOwner(await collectAgentDeviceSignatures(crypto, userId))
      );
      commit(trusted);
    } catch {
      // Fail safe: hide the affordance if crypto cannot report device trust.
      commit(false);
    }
  }, [mx, crypto, userId, alive]);

  useEffect(() => {
    update();
  }, [update]);

  useDeviceListChange(
    useCallback(
      (userIds) => {
        if (userIds.includes(userId)) {
          if (crypto) {
            scheduleAgentDeviceTrustRefresh(crypto, userId, () => void update());
          }
        }
      },
      [crypto, userId, update]
    )
  );

  return trustState.crypto === crypto && trustState.userId === userId && trustState.value;
};
