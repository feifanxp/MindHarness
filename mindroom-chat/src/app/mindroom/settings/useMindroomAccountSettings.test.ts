import { MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE } from './mindroomAccountSettings';
import { enqueueMindroomAccountSettingsPatch } from './useMindroomAccountSettings';

const makeClient = (initial: Record<string, unknown>) => {
  let content = initial;
  const setAccountData = vi.fn(async (_type: string, next: Record<string, unknown>) => {
    content = next;
  });
  const mx = {
    getAccountData: vi.fn(() => ({ getContent: () => content })),
    setAccountData,
  } as unknown as MatrixClient;
  return { mx, setAccountData };
};

describe('enqueueMindroomAccountSettingsPatch', () => {
  it('serializes same-turn patches and keeps the last value for each setting', async () => {
    const { mx, setAccountData } = makeClient({ simpleMode: false, futureKey: 'keep' });

    const first = enqueueMindroomAccountSettingsPatch(mx, { simpleMode: true });
    const second = enqueueMindroomAccountSettingsPatch(mx, { simpleMode: false });
    await Promise.all([first, second]);

    expect(setAccountData).toHaveBeenCalledTimes(2);
    expect(setAccountData).toHaveBeenLastCalledWith(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, {
      simpleMode: false,
      futureKey: 'keep',
    });
  });

  it('serializes patches queued during a write and re-reads echoed content', async () => {
    let content: Record<string, unknown> = { simpleMode: false, futureKey: 'v1' };
    let releaseFirst: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const setAccountData = vi
      .fn()
      .mockImplementationOnce(async (_type: string, next: Record<string, unknown>) => {
        await firstWrite;
        content = { ...next, futureKey: 'server-v2' };
      })
      .mockImplementationOnce(async (_type: string, next: Record<string, unknown>) => {
        content = next;
      });
    const mx = {
      getAccountData: vi.fn(() => ({ getContent: () => content })),
      setAccountData,
    } as unknown as MatrixClient;

    const first = enqueueMindroomAccountSettingsPatch(mx, { simpleMode: true });
    await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledTimes(1));
    const second = enqueueMindroomAccountSettingsPatch(mx, { simpleMode: false });
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(setAccountData).toHaveBeenCalledTimes(2);
    expect(setAccountData).toHaveBeenLastCalledWith(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, {
      simpleMode: false,
      futureKey: 'server-v2',
    });
  });

  it('continues with a later patch after a failed batch', async () => {
    const { mx, setAccountData } = makeClient({ simpleMode: false });
    setAccountData.mockRejectedValueOnce(new Error('offline'));

    await expect(enqueueMindroomAccountSettingsPatch(mx, { simpleMode: true })).rejects.toThrow(
      'offline'
    );
    await expect(
      enqueueMindroomAccountSettingsPatch(mx, { simpleMode: false })
    ).resolves.toBeUndefined();

    expect(setAccountData).toHaveBeenCalledTimes(2);
  });
});
