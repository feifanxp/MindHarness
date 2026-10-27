import { getHomePath } from '../pathUtils';

type LocationParts = {
  pathname: string;
  search?: string;
  hash?: string;
};

export const buildSessionLastKnownPath = ({
  pathname,
  search = '',
  hash = '',
}: LocationParts): string => `${pathname}${search}${hash}`;

const isSafeSessionRestorePath = (lastKnownPath: string): boolean =>
  lastKnownPath.startsWith('/') && !lastKnownPath.startsWith('//');

export const resolveSessionRestorePath = (lastKnownPath?: string): string => {
  if (typeof lastKnownPath === 'string' && isSafeSessionRestorePath(lastKnownPath)) {
    return lastKnownPath;
  }

  return getHomePath();
};
