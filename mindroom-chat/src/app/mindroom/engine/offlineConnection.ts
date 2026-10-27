import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

export type OfflineConnectionState = { connected: boolean; unmetered: boolean };
export type OfflineConnection = {
  getSnapshot(): OfflineConnectionState;
  subscribe(listener: () => void): () => void;
};
type WebConnection = EventTarget & { type?: string; saveData?: boolean; effectiveType?: string };

const webState = (): OfflineConnectionState => {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const connection = (nav as (Navigator & { connection?: WebConnection }) | undefined)?.connection;
  return {
    connected: nav?.onLine !== false,
    // effectiveType is estimated speed, not a promise of unmetered wifi.
    unmetered: connection?.type === 'wifi' && connection.saveData !== true,
  };
};

/** One platform adapter; native APIs do not expose metered Wi-Fi/Low Data Mode.
 * Their wifi report still uses the bounded automatic per-visit allowance. */
export const createOfflineConnection = (): OfflineConnection => {
  const native = Capacitor.isNativePlatform();
  let snapshot = native ? { connected: true, unmetered: false } : webState();
  return {
    getSnapshot: () => (native ? snapshot : webState()),
    subscribe: (notify) => {
      if (!native) {
        const connection = (
          typeof navigator === 'undefined'
            ? undefined
            : (navigator as Navigator & { connection?: WebConnection })
        )?.connection;
        const changed = () => notify();
        if (typeof window !== 'undefined') {
          window.addEventListener('online', changed);
          window.addEventListener('offline', changed);
        }
        connection?.addEventListener?.('change', changed);
        return () => {
          if (typeof window !== 'undefined') {
            window.removeEventListener('online', changed);
            window.removeEventListener('offline', changed);
          }
          connection?.removeEventListener?.('change', changed);
        };
      }
      let stopped = false;
      let receivedChange = false;
      const update = (status: { connected: boolean; connectionType: string }) => {
        if (stopped) return;
        snapshot = { connected: status.connected, unmetered: status.connectionType === 'wifi' };
        notify();
      };
      const handle = Network.addListener('networkStatusChange', (status) => {
        receivedChange = true;
        update(status);
      });
      void Network.getStatus()
        .then((status) => {
          if (!receivedChange) update(status);
        })
        .catch(() => undefined);
      void handle.catch(() => undefined);
      return () => {
        stopped = true;
        void handle.then((listener) => listener.remove()).catch(() => undefined);
      };
    },
  };
};
