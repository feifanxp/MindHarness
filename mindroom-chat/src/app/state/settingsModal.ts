import { atom } from 'jotai';
import { SettingsPage } from '../features/settings/settingsPages';

export type SettingsModalState = {
  initialPage?: SettingsPage;
  requestId?: string;
};

export const settingsModalAtom = atom<SettingsModalState | undefined>(undefined);
