import { StoredSession } from '../../state/sessions';
import { resolveSessionRestorePath } from '../client/sessionRouteRestore';

export const ADD_ACCOUNT_SEARCH_PARAM = 'addAccount';
export const ADD_ACCOUNT_SEARCH_VALUE = '1';

export const isAddAccountSearch = (search: string | URLSearchParams): boolean => {
  const searchParams =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;

  return searchParams.get(ADD_ACCOUNT_SEARCH_PARAM) === ADD_ACCOUNT_SEARCH_VALUE;
};

type AddAccountReturnSession = Pick<StoredSession, 'lastKnownPath'>;

export const resolveAddAccountReturnPath = (
  search: string | URLSearchParams,
  activeSession?: AddAccountReturnSession
): string | undefined => {
  if (!activeSession || !isAddAccountSearch(search)) {
    return undefined;
  }

  return resolveSessionRestorePath(activeSession.lastKnownPath);
};

export const withAddAccountSearch = (path: string): string => {
  const [pathWithSearch, hash = ''] = path.split('#', 2);
  const [pathname, search = ''] = pathWithSearch.split('?', 2);
  const searchParams = new URLSearchParams(search);

  searchParams.set(ADD_ACCOUNT_SEARCH_PARAM, ADD_ACCOUNT_SEARCH_VALUE);

  const nextSearch = searchParams.toString();
  const nextHash = hash ? `#${hash}` : '';
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`;
};

export const withAddAccountSearchIf = (path: string, addAccount: boolean): string =>
  addAccount ? withAddAccountSearch(path) : path;
