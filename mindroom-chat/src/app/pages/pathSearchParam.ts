import { _RoomSearchParams, DirectCreateSearchParams } from './paths';

type SearchParamsGetter<T> = (searchParams: URLSearchParams) => T;

export const getRoomSearchParams: SearchParamsGetter<_RoomSearchParams> = (searchParams) => ({
  focusEvent: searchParams.get('focusEvent') ?? undefined,
  viaServers: searchParams.get('viaServers') ?? undefined,
  threadId: searchParams.get('threadId') ?? undefined,
});

export const getDirectCreateSearchParams: SearchParamsGetter<DirectCreateSearchParams> = (
  searchParams
) => ({
  userId: searchParams.get('userId') ?? undefined,
});
