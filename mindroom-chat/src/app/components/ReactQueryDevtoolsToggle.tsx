import React from 'react';

const REACT_QUERY_DEVTOOLS_PARAM = 'reactQueryDevtools';
export const REACT_QUERY_DEVTOOLS_STORAGE_KEY = 'mindroom.reactQueryDevtools';

type ReactQueryDevtoolsLocation = Pick<Location, 'hash' | 'search'>;
type ReactQueryDevtoolsStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type ReactQueryDevtoolsOptions = {
  envValue?: unknown;
  location?: ReactQueryDevtoolsLocation;
  storage?: ReactQueryDevtoolsStorage;
};

const LazyReactQueryDevtools = React.lazy(() =>
  import('@tanstack/react-query-devtools').then(({ ReactQueryDevtools }) => ({
    default: ReactQueryDevtools,
  }))
);

const getWindowLocation = (): ReactQueryDevtoolsLocation | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.location;
};

const getWindowStorage = (): ReactQueryDevtoolsStorage | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const appendSearchParamValues = (query: string, values: string[]) => {
  if (!query) {
    return;
  }

  const search = query.startsWith('?') ? query.slice(1) : query;
  const searchParams = new URLSearchParams(search);
  values.push(...searchParams.getAll(REACT_QUERY_DEVTOOLS_PARAM));
};

const getReactQueryDevtoolsQueryValues = (
  location: ReactQueryDevtoolsLocation | undefined
): string[] => {
  if (!location) {
    return [];
  }

  const values: string[] = [];
  appendSearchParamValues(location.search, values);

  const hashQueryIndex = location.hash.indexOf('?');
  if (hashQueryIndex >= 0) {
    appendSearchParamValues(location.hash.slice(hashQueryIndex + 1), values);
  }

  return values.map((value) => value.trim().toLowerCase());
};

const getStorageFlag = (storage: ReactQueryDevtoolsStorage | undefined): string | null => {
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY);
  } catch {
    return null;
  }
};

const setStorageFlag = (storage: ReactQueryDevtoolsStorage | undefined) => {
  try {
    storage?.setItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY, 'true');
  } catch {
    // Ignore storage failures; the current query-param request should still enable devtools.
  }
};

const clearStorageFlag = (storage: ReactQueryDevtoolsStorage | undefined) => {
  try {
    storage?.removeItem(REACT_QUERY_DEVTOOLS_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the current query-param request should still disable devtools.
  }
};

export const isReactQueryDevtoolsEnabled = ({
  envValue = import.meta.env.VITE_ENABLE_REACT_QUERY_DEVTOOLS,
  location = getWindowLocation(),
  storage = getWindowStorage(),
}: ReactQueryDevtoolsOptions = {}): boolean => {
  const queryValues = getReactQueryDevtoolsQueryValues(location);

  if (queryValues.some((value) => value === '0' || value === 'false')) {
    clearStorageFlag(storage);
    return false;
  }

  if (queryValues.some((value) => value === '1' || value === 'true')) {
    setStorageFlag(storage);
    return true;
  }

  if (getStorageFlag(storage) === 'true') {
    return true;
  }

  return envValue === 'true';
};

export function ReactQueryDevtoolsToggle() {
  if (!isReactQueryDevtoolsEnabled()) {
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <LazyReactQueryDevtools initialIsOpen={false} />
    </React.Suspense>
  );
}
