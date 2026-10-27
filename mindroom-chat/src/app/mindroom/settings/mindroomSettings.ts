import { atom } from 'jotai';
import {
  loadMindroomSettings,
  saveMindroomSettings,
  sanitizeMindroomSettings,
  type MindroomSettings,
} from './mindroomSettingsStorage';

export type { MindroomSettings } from './mindroomSettingsStorage';

const baseMindroomSettingsAtom = atom<MindroomSettings>(loadMindroomSettings());

export const mindroomSettingsAtom = atom<MindroomSettings, [MindroomSettings], undefined>(
  (get) => get(baseMindroomSettingsAtom),
  (_get, set, update) => {
    const next = sanitizeMindroomSettings(update);
    set(baseMindroomSettingsAtom, next);
    saveMindroomSettings(next);
  }
);
