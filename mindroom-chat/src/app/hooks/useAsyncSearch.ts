import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MatchHandler,
  AsyncSearch,
  AsyncSearchHandler,
  AsyncSearchOption,
  MatchQueryOption,
  NormalizeOption,
  normalize,
  matchQuery,
  ResultHandler,
} from '../utils/AsyncSearch';
import { sanitizeForRegex } from '../utils/regex';

export type UseAsyncSearchOptions = AsyncSearchOption & {
  matchOptions?: MatchQueryOption;
  normalizeOptions?: NormalizeOption;
};

export type SearchItemStrGetter<TSearchItem extends object | string | number> = (
  searchItem: TSearchItem,
  query: string
) => string | string[];

export type UseAsyncSearchResult<TSearchItem extends object | string | number> = {
  query: string;
  items: TSearchItem[];
};

export type SearchResetHandler = () => void;

const performMatch = (
  target: string | string[],
  query: string,
  options?: UseAsyncSearchOptions
): string | undefined => {
  if (Array.isArray(target)) {
    const matchTarget = target.find((i) =>
      matchQuery(normalize(i, options?.normalizeOptions), query, options?.matchOptions)
    );
    return matchTarget ? normalize(matchTarget, options?.normalizeOptions) : undefined;
  }

  const normalizedTargetStr = normalize(target, options?.normalizeOptions);
  const matches = matchQuery(normalizedTargetStr, query, options?.matchOptions);
  return matches ? normalizedTargetStr : undefined;
};

export const orderSearchItems = <TSearchItem extends object | string | number>(
  query: string,
  items: TSearchItem[],
  getItemStr: SearchItemStrGetter<TSearchItem>,
  options?: UseAsyncSearchOptions
): TSearchItem[] => {
  const orderedItems: TSearchItem[] = Array.from(items);

  // we will consider "_" as word boundary char.
  // because in more use-cases it is used. (like: emojishortcode)
  const boundaryRegex = new RegExp(`(\\b|_)${sanitizeForRegex(query)}`);
  const perfectBoundaryRegex = new RegExp(`(\\b|_)${sanitizeForRegex(query)}(\\b|_)`);

  orderedItems.sort((i1, i2) => {
    const str1 = performMatch(getItemStr(i1, query), query, options);
    const str2 = performMatch(getItemStr(i2, query), query, options);

    if (str1 === undefined && str2 === undefined) return 0;
    if (str1 === undefined) return 1;
    if (str2 === undefined) return -1;

    let points1 = 0;
    let points2 = 0;

    // short string should score more
    const pointsToSmallStr = (points: number) => {
      if (str1.length < str2.length) points1 += points;
      else if (str2.length < str1.length) points2 += points;
    };
    pointsToSmallStr(1);

    // closes query match should score more
    const indexIn1 = str1.indexOf(query);
    const indexIn2 = str2.indexOf(query);
    if (indexIn1 < indexIn2) points1 += 2;
    else if (indexIn2 < indexIn1) points2 += 2;
    else pointsToSmallStr(2);

    // query match word start on boundary should score more
    const boundaryIn1 = str1.match(boundaryRegex);
    const boundaryIn2 = str2.match(boundaryRegex);
    if (boundaryIn1 && boundaryIn2) pointsToSmallStr(4);
    else if (boundaryIn1) points1 += 4;
    else if (boundaryIn2) points2 += 4;

    // query match word start and end on boundary should score more
    const perfectBoundaryIn1 = str1.match(perfectBoundaryRegex);
    const perfectBoundaryIn2 = str2.match(perfectBoundaryRegex);
    if (perfectBoundaryIn1 && perfectBoundaryIn2) pointsToSmallStr(8);
    else if (perfectBoundaryIn1) points1 += 8;
    else if (perfectBoundaryIn2) points2 += 8;

    return points2 - points1;
  });

  return orderedItems;
};

// searchNow runs during render, so it reads at most this many items (a few ms); the async search reads the rest.
export const SEARCH_NOW_SCAN_LIMIT = 5000;

/**
 * What `useAsyncSearch` finds for `query`, computed at once: the first `limit` matches, ordered.
 * `scannedAll` is false when it stopped before the end of the list, at `limit` matches or
 * `SEARCH_NOW_SCAN_LIMIT` items.
 */
export const searchNow = <TSearchItem extends object | string | number>(
  list: TSearchItem[],
  query: string,
  getItemStr: SearchItemStrGetter<TSearchItem>,
  options?: UseAsyncSearchOptions
): { items: TSearchItem[]; scannedAll: boolean } => {
  const normalizedQuery = normalize(query, options?.normalizeOptions);
  const limit = options?.limit ?? Infinity;
  const end = Math.min(list.length, SEARCH_NOW_SCAN_LIMIT);
  const matches: TSearchItem[] = [];
  let i = 0;
  for (; i < end && matches.length < limit; i += 1) {
    if (performMatch(getItemStr(list[i], normalizedQuery), normalizedQuery, options)) {
      matches.push(list[i]);
    }
  }
  const items = orderSearchItems(normalizedQuery, matches, getItemStr, options);
  return { items, scannedAll: i === list.length };
};

export const useAsyncSearch = <TSearchItem extends object | string | number>(
  list: TSearchItem[],
  getItemStr: SearchItemStrGetter<TSearchItem>,
  options?: UseAsyncSearchOptions
): [UseAsyncSearchResult<TSearchItem> | undefined, AsyncSearchHandler, SearchResetHandler] => {
  const [result, setResult] = useState<UseAsyncSearchResult<TSearchItem>>();

  const [searchCallback, terminateSearch] = useMemo(() => {
    setResult(undefined);

    const handleMatch: MatchHandler<TSearchItem> = (item, query) => {
      const itemStr = getItemStr(item, query);

      const strWithMatch = performMatch(itemStr, query, options);
      return typeof strWithMatch === 'string';
    };

    const handleResult: ResultHandler<TSearchItem> = (results, query) =>
      setResult({
        query,
        items: orderSearchItems(query, results, getItemStr, options),
      });

    return AsyncSearch(list, handleMatch, handleResult, options);
  }, [list, options, getItemStr]);

  const searchHandler: AsyncSearchHandler = useCallback(
    (query) => {
      const normalizedQuery = normalize(query, options?.normalizeOptions);
      searchCallback(normalizedQuery);
    },
    [searchCallback, options?.normalizeOptions]
  );

  const resetHandler: SearchResetHandler = useCallback(() => {
    terminateSearch();
    setResult(undefined);
  }, [terminateSearch]);

  useEffect(
    () => () => {
      // terminate any ongoing search request on unmount.
      terminateSearch();
    },
    [terminateSearch]
  );

  return [result, searchHandler, resetHandler];
};
