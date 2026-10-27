import {
  IEventWithRoomId,
  IResultContext,
  ISearchRequestBody,
  ISearchResponse,
  ISearchResult,
  RelationType,
  SearchOrderBy,
} from 'matrix-js-sdk';
import { useCallback } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';

export type ResultItem = {
  rank: number;
  event: IEventWithRoomId;
  context: IResultContext;
};

export type ResultGroup = {
  roomId: string;
  items: ResultItem[];
};

export type SearchResult = {
  nextToken?: string;
  highlights: string[];
  groups: ResultGroup[];
};

const groupSearchResult = (results: ISearchResult[]): ResultGroup[] => {
  const groups: ResultGroup[] = [];

  results.forEach((item) => {
    const roomId = item.result.room_id;
    const resultItem: ResultItem = {
      rank: item.rank,
      event: item.result,
      context: item.context,
    };

    const lastAddedGroup: ResultGroup | undefined = groups[groups.length - 1];
    if (lastAddedGroup && roomId === lastAddedGroup.roomId) {
      lastAddedGroup.items.push(resultItem);
      return;
    }
    groups.push({
      roomId,
      items: [resultItem],
    });
  });

  return groups;
};

export const getCanonicalSearchEventId = (event: IEventWithRoomId): string | undefined => {
  const relation = event.content?.['m.relates_to'];

  if (
    relation?.rel_type === RelationType.Replace &&
    typeof relation.event_id === 'string' &&
    relation.event_id.length > 0
  ) {
    return relation.event_id;
  }

  if (typeof event.event_id === 'string' && event.event_id.length > 0) {
    return event.event_id;
  }

  return undefined;
};

export const getCanonicalSearchEventKey = (event: IEventWithRoomId): string | undefined => {
  const canonicalEventId = getCanonicalSearchEventId(event);
  if (!canonicalEventId) return undefined;

  // The sender is part of the key so an edit only replaces a message from the same sender, as in the timeline.
  return `${event.room_id}|${canonicalEventId}|${event.sender}`;
};

const getSearchResultTimestamp = (result: ISearchResult): number =>
  typeof result.result.origin_server_ts === 'number' ? result.result.origin_server_ts : 0;

export const deduplicateResults = (results: ISearchResult[]): ISearchResult[] => {
  const winners = new Map<string, ISearchResult>();

  results.forEach((result) => {
    const canonicalEventKey = getCanonicalSearchEventKey(result.result);
    if (!canonicalEventKey) return;

    const currentWinner = winners.get(canonicalEventKey);
    if (
      !currentWinner ||
      getSearchResultTimestamp(result) >= getSearchResultTimestamp(currentWinner)
    ) {
      winners.set(canonicalEventKey, result);
    }
  });

  return results.filter((result) => {
    const canonicalEventKey = getCanonicalSearchEventKey(result.result);
    if (!canonicalEventKey) return true;

    return winners.get(canonicalEventKey) === result;
  });
};

const parseSearchResult = (result: ISearchResponse): SearchResult => {
  const roomEvents = result.search_categories.room_events;

  const searchResult: SearchResult = {
    nextToken: roomEvents?.next_batch,
    highlights: roomEvents?.highlights ?? [],
    groups: groupSearchResult(deduplicateResults(roomEvents?.results ?? [])),
  };

  return searchResult;
};

export type MessageSearchParams = {
  term?: string;
  order?: string;
  rooms?: string[];
  senders?: string[];
};
export const useMessageSearch = (params: MessageSearchParams) => {
  const mx = useMatrixClient();
  const { term, order, rooms, senders } = params;

  const searchMessages = useCallback(
    async (nextBatch?: string) => {
      if (!term)
        return {
          highlights: [],
          groups: [],
        };
      const limit = 20;

      const requestBody: ISearchRequestBody = {
        search_categories: {
          room_events: {
            event_context: {
              before_limit: 0,
              after_limit: 0,
              include_profile: false,
            },
            filter: {
              limit,
              rooms,
              senders,
            },
            include_state: false,
            order_by: order as SearchOrderBy.Recent,
            search_term: term,
          },
        },
      };

      const r = await mx.search({
        body: requestBody,
        next_batch: nextBatch === '' ? undefined : nextBatch,
      });
      return parseSearchResult(r);
    },
    [mx, term, order, rooms, senders]
  );

  return searchMessages;
};
