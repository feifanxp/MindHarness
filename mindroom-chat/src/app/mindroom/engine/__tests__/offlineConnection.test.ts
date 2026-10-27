import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ enabled: false, getStatus: vi.fn(), addListener: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled } }));
vi.mock('@capacitor/network', () => ({ Network: native }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  native.enabled = false;
  native.getStatus.mockReset();
  native.addListener.mockReset();
});
it('unknown web links remain bounded and saveData overrides wifi', async () => {
  vi.stubGlobal('navigator', {
    onLine: true,
    connection: {
      type: 'wifi',
      saveData: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  const { createOfflineConnection } = await import('../offlineConnection');
  const connection = createOfflineConnection();
  expect(connection.getSnapshot()).toEqual({ connected: true, unmetered: false });
  vi.stubGlobal('navigator', { onLine: true });
  expect(createOfflineConnection().getSnapshot()).toEqual({ connected: true, unmetered: false });
});
it('removes a native listener that finishes registering after unsubscribe', async () => {
  native.enabled = true;
  native.getStatus.mockResolvedValue({ connected: true, connectionType: 'wifi' });
  let resolve!: (handle: { remove: () => Promise<void> }) => void;
  native.addListener.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { createOfflineConnection } = await import('../offlineConnection');
  const connection = createOfflineConnection();
  const listener = vi.fn();
  const stop = connection.subscribe(listener);
  stop();
  const remove = vi.fn().mockResolvedValue(undefined);
  resolve({ remove });
  await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  expect(listener).not.toHaveBeenCalled();
});
