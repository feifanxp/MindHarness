import { useLayoutEffect, useMemo } from 'react';
import { makeRecentThreadsAtom, registerRecentThreadsAtom } from '../recent-threads/recentThreads';

// `bumpRecentThread` (imperative write from `noteThreadOpened`) is the only
// writer that resolves the active atom, so recentThreadsAtom registers here.

export type MindroomClientStorageAtoms = {
  userId: string;
  recentThreadsAtom: ReturnType<typeof makeRecentThreadsAtom>;
};

export const makeMindroomClientStorageAtoms = (userId: string): MindroomClientStorageAtoms => ({
  userId,
  recentThreadsAtom: makeRecentThreadsAtom(userId),
});

export const registerMindroomClientStorageAtoms = ({
  userId,
  recentThreadsAtom,
}: MindroomClientStorageAtoms): (() => void) =>
  registerRecentThreadsAtom(userId, recentThreadsAtom);

export const useMindroomClientStorageAtoms = (userId: string): void => {
  const storageAtoms = useMemo(() => makeMindroomClientStorageAtoms(userId), [userId]);

  useLayoutEffect(() => registerMindroomClientStorageAtoms(storageAtoms), [storageAtoms]);
};
