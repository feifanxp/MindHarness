import { useTranslation } from 'react-i18next';
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Text, Box, Icon, Icons, config, Spinner, IconButton, Line, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SearchOrderBy } from 'matrix-js-sdk';
import { PageHero, PageHeroEmpty, PageHeroSection } from '../../components/page';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { _SearchPathSearchParams } from '../../pages/paths';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { SequenceCard } from '../../components/sequence-card';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { ScrollTopContainer } from '../../components/scroll-top-container';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { decodeSearchParamValueArray, encodeSearchParamValueArray } from '../../pages/pathUtils';
import { useRooms } from '../../state/hooks/roomList';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { mDirectAtom } from '../../state/mDirectList';
import {
  getCanonicalSearchEventKey,
  MessageSearchParams,
  useMessageSearch,
} from './useMessageSearch';
import {
  SearchResultBodyRenderer,
  SearchResultGroupHeader,
  SearchResultItemCard,
} from './SearchResultGroup';
import { SearchInput } from './SearchInput';
import { SearchFilters } from './SearchFilters';
import { VirtualTile } from '../../components/virtualizer';
import { shouldFetchNextMessageSearchPage } from './messageSearchPagination';
import { getMessageSearchRenderState } from './messageSearchRenderState';
import {
  normalizeMessageSearchRooms,
  shouldDeferImplicitMessageSearch,
} from './messageSearchScope';
import { flattenMessageSearchRows, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT } from './messageSearchRows';
import { useInitialClientCatchup } from '../../hooks/useInitialClientCatchup';

const useSearchPathSearchParams = (searchParams: URLSearchParams): _SearchPathSearchParams =>
  useMemo(
    () => ({
      global: searchParams.get('global') ?? undefined,
      term: searchParams.get('term') ?? undefined,
      order: searchParams.get('order') ?? undefined,
      rooms: searchParams.get('rooms') ?? undefined,
      senders: searchParams.get('senders') ?? undefined,
    }),
    [searchParams]
  );

export type MessageSearchProps = {
  defaultRoomsFilterName: string;
  allowGlobal?: boolean;
  rooms: string[];
  senders?: string[];
  scrollRef: RefObject<HTMLDivElement>;
  renderBody: SearchResultBodyRenderer;
};
export function MessageSearch({
  defaultRoomsFilterName,
  allowGlobal,
  rooms,
  senders,
  scrollRef,
  renderBody,
}: MessageSearchProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const allRooms = useRooms(mx, allRoomsAtom, mDirects);
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollTopAnchorRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchPathSearchParams = useSearchPathSearchParams(searchParams);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const [implicitRoomsReady, setImplicitRoomsReady] = useState(false);

  const searchParamRooms = useMemo(() => {
    if (searchPathSearchParams.rooms) {
      const joinedRoomIds = decodeSearchParamValueArray(searchPathSearchParams.rooms).filter(
        (rId) => allRooms.includes(rId)
      );
      return joinedRoomIds;
    }
    return undefined;
  }, [allRooms, searchPathSearchParams.rooms]);
  const normalizedSearchParamRooms = useMemo(
    () => normalizeMessageSearchRooms(searchParamRooms),
    [searchParamRooms]
  );
  const normalizedDefaultRooms = useMemo(() => normalizeMessageSearchRooms(rooms) ?? [], [rooms]);
  const normalizedDefaultRoomsKey = useMemo(
    () => normalizedDefaultRooms.join('\n'),
    [normalizedDefaultRooms]
  );
  const globalSearch = searchPathSearchParams.global === 'true';
  const searchParamsSenders = useMemo(() => {
    if (searchPathSearchParams.senders) {
      return decodeSearchParamValueArray(searchPathSearchParams.senders);
    }
    return undefined;
  }, [searchPathSearchParams.senders]);
  const hasExplicitRooms = !!normalizedSearchParamRooms;
  const initialCatchupInProgress = useInitialClientCatchup(mx);

  useEffect(() => {
    const hasTerm = !!searchPathSearchParams.term;

    if (!hasTerm || globalSearch || hasExplicitRooms) {
      setImplicitRoomsReady(true);
      return undefined;
    }

    if (initialCatchupInProgress || normalizedDefaultRooms.length === 0) {
      setImplicitRoomsReady(false);
      return undefined;
    }

    setImplicitRoomsReady(false);
    const timeoutId = setTimeout(() => {
      setImplicitRoomsReady(true);
    }, 500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    globalSearch,
    hasExplicitRooms,
    initialCatchupInProgress,
    normalizedDefaultRooms.length,
    normalizedDefaultRoomsKey,
    searchPathSearchParams.term,
  ]);

  const msgSearchParams: MessageSearchParams = useMemo(() => {
    return {
      term: searchPathSearchParams.term,
      order: searchPathSearchParams.order ?? SearchOrderBy.Recent,
      rooms: globalSearch ? undefined : normalizedSearchParamRooms ?? normalizedDefaultRooms,
      senders: searchParamsSenders ?? senders,
    };
  }, [
    globalSearch,
    normalizedDefaultRooms,
    normalizedSearchParamRooms,
    searchParamsSenders,
    searchPathSearchParams,
    senders,
  ]);

  const searchMessages = useMessageSearch(msgSearchParams);
  const searchEnabled =
    !!msgSearchParams.term &&
    !shouldDeferImplicitMessageSearch({
      hasTerm: !!msgSearchParams.term,
      global: globalSearch,
      hasExplicitRooms,
      implicitRoomsReady,
    }) &&
    (globalSearch || hasExplicitRooms || normalizedDefaultRooms.length > 0);

  const { status, data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    enabled: searchEnabled,
    queryKey: [
      'search',
      msgSearchParams.term,
      msgSearchParams.order,
      msgSearchParams.rooms,
      msgSearchParams.senders,
    ],
    queryFn: ({ pageParam }) => searchMessages(pageParam),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextToken,
  });

  const groups = useMemo(() => {
    const allResults = data?.pages.flatMap((result) => result.groups) ?? [];
    const seenIds = new Set<string>();

    return allResults.flatMap((group) => {
      const items = group.items.filter((item) => {
        const canonicalEventKey = getCanonicalSearchEventKey(item.event);
        if (!canonicalEventKey) return true;
        if (seenIds.has(canonicalEventKey)) return false;

        seenIds.add(canonicalEventKey);
        return true;
      });

      return items.length > 0 ? [{ ...group, items }] : [];
    });
  }, [data]);
  const highlights = useMemo(() => {
    const mixed = data?.pages.flatMap((result) => result.highlights);
    return Array.from(new Set(mixed));
  }, [data]);
  const rows = useMemo(() => flattenMessageSearchRows(groups), [groups]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'room-header' ? 44 : 168),
    overscan: 4,
  });
  const vItems = virtualizer.getVirtualItems();
  const renderState = useMemo(
    () =>
      getMessageSearchRenderState({
        hasTerm: !!msgSearchParams.term,
        status,
        groupsCount: rows.length,
        virtualItemCount: vItems.length,
      }),
    [msgSearchParams.term, rows.length, status, vItems.length]
  );
  const fallbackRows = useMemo(() => rows.slice(0, MESSAGE_SEARCH_FALLBACK_ROW_LIMIT), [rows]);

  const handleSearch = (term: string) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('term');
      newParams.append('term', term);
      return newParams;
    });
  };
  const handleSearchClear = () => {
    if (searchInputRef.current) {
      searchInputRef.current.value = '';
    }
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('term');
      return newParams;
    });
  };

  const handleSelectedRoomsChange = (selectedRooms?: string[]) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('rooms');
      if (selectedRooms && selectedRooms.length > 0) {
        newParams.append('rooms', encodeSearchParamValueArray(selectedRooms));
      }
      return newParams;
    });
  };
  const handleGlobalChange = (global?: boolean) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('global');
      if (global) {
        newParams.append('global', 'true');
      }
      return newParams;
    });
  };

  const handleOrderChange = (order?: string) => {
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.delete('order');
      if (order) {
        newParams.append('order', order);
      }
      return newParams;
    });
  };

  const handleOpen = (roomId: string, eventId: string, threadRootId?: string) => {
    if (threadRootId) {
      navigateRoomThread(roomId, threadRootId, eventId);
      return;
    }
    navigateRoom(roomId, eventId);
  };

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;

    const maybeFetchNextPage = () => {
      if (
        shouldFetchNextMessageSearchPage({
          hasNextPage: !!hasNextPage,
          isFetchingNextPage,
          scrollTop: scrollElement.scrollTop,
          clientHeight: scrollElement.clientHeight,
          scrollHeight: scrollElement.scrollHeight,
        })
      ) {
        fetchNextPage();
      }
    };

    maybeFetchNextPage();
    scrollElement.addEventListener('scroll', maybeFetchNextPage, { passive: true });

    return () => {
      scrollElement.removeEventListener('scroll', maybeFetchNextPage);
    };
  }, [scrollRef, fetchNextPage, isFetchingNextPage, hasNextPage, groups.length]);

  return (
    <Box direction="Column" gap="700">
      <ScrollTopContainer scrollRef={scrollRef} anchorRef={scrollTopAnchorRef}>
        <IconButton
          onClick={() => virtualizer.scrollToOffset(0)}
          variant="SurfaceVariant"
          radii="Pill"
          outlined
          size="300"
          aria-label={t('mindroomUi.message-search.messageSearch.scrollToTop')}
        >
          <Icon src={Icons.ChevronTop} size="300" />
        </IconButton>
      </ScrollTopContainer>
      <Box ref={scrollTopAnchorRef} direction="Column" gap="300">
        <SearchInput
          active={!!msgSearchParams.term}
          loading={status === 'pending'}
          searchInputRef={searchInputRef}
          onSearch={handleSearch}
          onReset={handleSearchClear}
        />
        <SearchFilters
          defaultRoomsFilterName={defaultRoomsFilterName}
          allowGlobal={allowGlobal}
          roomList={searchPathSearchParams.global === 'true' ? allRooms : rooms}
          selectedRooms={searchParamRooms}
          onSelectedRoomsChange={handleSelectedRoomsChange}
          global={searchPathSearchParams.global === 'true'}
          onGlobalChange={handleGlobalChange}
          order={msgSearchParams.order}
          onOrderChange={handleOrderChange}
        />
      </Box>

      {!msgSearchParams.term && status === 'pending' && (
        <PageHeroEmpty>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Message} />}
              title={t('mindroomUi.message-search.messageSearch.searchMessages')}
              subTitle={t('mindroomUi.message-search.messageSearch.searchDescription')}
            />
          </PageHeroSection>
        </PageHeroEmpty>
      )}

      {msgSearchParams.term && groups.length === 0 && status === 'success' && (
        <Box
          className={ContainerColor({ variant: 'Warning' })}
          style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
          alignItems="Center"
          gap="200"
        >
          <Icon size="200" src={Icons.Info} />
          <Text>
            {t('mindroomUi.message-search.messageSearch.noResultsFor', {
              term: msgSearchParams.term,
            })}
          </Text>
        </Box>
      )}

      {renderState.showLoadingSkeletons && (
        <Box direction="Column" gap="100">
          {[...Array(8).keys()].map((key) => (
            <SequenceCard variant="SurfaceVariant" key={key} style={{ minHeight: toRem(80) }} />
          ))}
        </Box>
      )}

      {renderState.showVirtualizerFallback && (
        <Box direction="Column" gap="300">
          <Box direction="Column" gap="200">
            <Text size="H5">
              {t('mindroomUi.message-search.messageSearch.resultsFor', {
                term: msgSearchParams.term,
              })}
            </Text>
            <Line size="300" variant="Surface" />
          </Box>
          <Box direction="Column" gap="500">
            {fallbackRows.map((row) => {
              const groupRoom = mx.getRoom(row.roomId);
              if (!groupRoom) return null;

              if (row.kind === 'room-header') {
                return <SearchResultGroupHeader key={row.key} room={groupRoom} />;
              }

              return (
                <SearchResultItemCard
                  key={row.key}
                  room={groupRoom}
                  item={row.item}
                  highlights={highlights}
                  onOpen={handleOpen}
                  legacyUsernameColor={legacyUsernameColor || mDirects.has(groupRoom.roomId)}
                  hour24Clock={hour24Clock}
                  dateFormatString={dateFormatString}
                  renderBody={renderBody}
                />
              );
            })}
          </Box>
          {isFetchingNextPage && (
            <Box justifyContent="Center" alignItems="Center">
              <Spinner size="600" variant="Secondary" />
            </Box>
          )}
        </Box>
      )}

      {renderState.showVirtualizedResults && (
        <Box direction="Column" gap="300">
          <Box direction="Column" gap="200">
            <Text size="H5">
              {t('mindroomUi.message-search.messageSearch.resultsFor', {
                term: msgSearchParams.term,
              })}
            </Text>
            <Line size="300" variant="Surface" />
          </Box>
          <div
            style={{
              position: 'relative',
              height: virtualizer.getTotalSize(),
            }}
          >
            {vItems.map((vItem) => {
              const row = rows[vItem.index];
              if (!row) return null;
              const groupRoom = mx.getRoom(row.roomId);
              if (!groupRoom) return null;

              return (
                <VirtualTile
                  virtualItem={vItem}
                  style={{ paddingBottom: config.space.S500 }}
                  ref={virtualizer.measureElement}
                  key={row.key}
                >
                  {row.kind === 'room-header' ? (
                    <SearchResultGroupHeader room={groupRoom} />
                  ) : (
                    <SearchResultItemCard
                      room={groupRoom}
                      item={row.item}
                      highlights={highlights}
                      onOpen={handleOpen}
                      legacyUsernameColor={legacyUsernameColor || mDirects.has(groupRoom.roomId)}
                      hour24Clock={hour24Clock}
                      dateFormatString={dateFormatString}
                      renderBody={renderBody}
                    />
                  )}
                </VirtualTile>
              );
            })}
          </div>
          {isFetchingNextPage && (
            <Box justifyContent="Center" alignItems="Center">
              <Spinner size="600" variant="Secondary" />
            </Box>
          )}
        </Box>
      )}

      {error && (
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{
            padding: config.space.S300,
            borderRadius: config.radii.R400,
          }}
          direction="Column"
          gap="200"
        >
          <Text size="L400">{error.name}</Text>
          <Text size="T300">{error.message}</Text>
        </Box>
      )}
    </Box>
  );
}
