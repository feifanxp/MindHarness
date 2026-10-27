import { atom, type WritableAtom, useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useMemo } from 'react';
import { Settings, settingsAtom as sAtom } from '../settings';

type SettingsWritableAtom<TSettings extends object> = WritableAtom<
  TSettings,
  [TSettings],
  undefined
>;

export type SettingSetter<TSettings extends object, K extends keyof TSettings> =
  | TSettings[K]
  | ((s: TSettings[K]) => TSettings[K]);

export const useSetSetting = <
  TSettings extends object = Settings,
  K extends keyof TSettings = keyof TSettings
>(
  settingsAtom: SettingsWritableAtom<TSettings>,
  key: K
): ((value: SettingSetter<TSettings, K>) => void) => {
  const setterAtom = useMemo(
    () =>
      atom<null, [SettingSetter<TSettings, K>], undefined>(null, (get, set, value) => {
        const s = { ...get(settingsAtom) };
        s[key] =
          typeof value === 'function'
            ? (value as (current: TSettings[K]) => TSettings[K])(s[key])
            : value;
        set(settingsAtom, s);
      }),
    [settingsAtom, key]
  );

  return useSetAtom(setterAtom);
};

export const useSetting = <
  TSettings extends object = Settings,
  K extends keyof TSettings = keyof TSettings
>(
  settingsAtom: SettingsWritableAtom<TSettings>,
  key: K
): [TSettings[K], (value: SettingSetter<TSettings, K>) => void] => {
  const selector = useMemo(() => (s: TSettings) => s[key], [key]);
  const setting = useAtomValue(selectAtom(settingsAtom, selector));

  const setter = useSetSetting(settingsAtom, key);
  return [setting, setter];
};
