import { atom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useCallback, useEffect } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  type MindroomAccountSettings,
  mergeMindroomAccountSettings,
  sanitizeMindroomAccountSettings,
} from './mindroomAccountSettings';

/**
 * In-memory mirror of the `io.mindroom.settings` account-data dictionary,
 * bound once at the client root (see `useBindAtoms`). Readers stay
 * client-free: components (and their tests) see the default simple interface
 * until the binder seeds the atom from account data.
 */
export const mindroomAccountSettingsAtom = atom<MindroomAccountSettings>(
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS
);

export const useBindMindroomAccountSettingsAtom = (
  mx: MatrixClient,
  settingsAtom: typeof mindroomAccountSettingsAtom
) => {
  const setSettings = useSetAtom(settingsAtom);

  useEffect(() => {
    // Seed unconditionally: an account without the event must reset a value
    // left behind by a previously bound account.
    setSettings(
      sanitizeMindroomAccountSettings(
        mx.getAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as any)?.getContent()
      )
    );

    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE) {
        setSettings(sanitizeMindroomAccountSettings(event.getContent()));
      }
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, setSettings]);
};

export const useMindroomAccountSettings = (): MindroomAccountSettings =>
  useAtomValue(mindroomAccountSettingsAtom);

const accountSettingsWriteTails = new WeakMap<MatrixClient, Promise<void>>();

/**
 * Serialize account-data patches per Matrix client. Every write re-reads the
 * latest account data, so independent patches preserve each other and unknown
 * keys. A rejected write does not poison later writes.
 */
export const enqueueMindroomAccountSettingsPatch = (
  mx: MatrixClient,
  patch: Partial<MindroomAccountSettings>
): Promise<void> => {
  const task = (accountSettingsWriteTails.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = mx.getAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as any)?.getContent();
      await mx.setAccountData(
        MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE as any,
        mergeMindroomAccountSettings(current, patch) as any
      );
    });
  accountSettingsWriteTails.set(mx, task);
  return task;
};

/**
 * Patch-writer for `io.mindroom.settings`. Merges over the currently stored
 * content so unknown keys written by other/newer clients survive. The bound
 * atom updates when the write echoes back over sync.
 */
export const useSetMindroomAccountSettings = (): ((
  patch: Partial<MindroomAccountSettings>
) => Promise<void>) => {
  const mx = useMatrixClient();
  return useCallback(
    (patch: Partial<MindroomAccountSettings>) => enqueueMindroomAccountSettingsPatch(mx, patch),
    [mx]
  );
};

export const useSimpleMode = (): boolean => useMindroomAccountSettings().simpleMode;

export const useShowCanvasesInSidebar = (): boolean =>
  useMindroomAccountSettings().showCanvasesInSidebar;
