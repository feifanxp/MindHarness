import { atom } from 'jotai';

export type LastExitedThread = {
  roomId: string;
  threadId: string;
};

export const lastExitedThreadAtom = atom<LastExitedThread | null>(null);
