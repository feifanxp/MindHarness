import { ReactNode, useCallback, useRef, useState } from 'react';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { useQuery } from '@tanstack/react-query';
import { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { LocalRoomSummary, useLocalRoomSummary } from '../hooks/useLocalRoomSummary';
import { AsyncState, AsyncStatus } from '../hooks/useAsyncCallback';
import { isRoomAlias, isRoomId } from '../utils/matrix';

export type IRoomSummary = Awaited<ReturnType<MatrixClient['getRoomSummary']>>;

type RoomSummaryLoaderProps = {
  roomIdOrAlias: string;
  viaServers?: string[];
  children: (
    state: AsyncState<IRoomSummary, Error>,
    retry: () => void,
    resolvedViaServers?: string[],
    resolvedRoomId?: string
  ) => ReactNode;
};

export function RoomSummaryLoader({ roomIdOrAlias, viaServers, children }: RoomSummaryLoaderProps) {
  const mx = useMatrixClient();
  const aliasResolutionRef = useRef<{
    alias: string;
    roomId: string;
    viaServers?: string[];
  }>();

  const fetchSummary = useCallback(async () => {
    let summaryTarget = roomIdOrAlias;
    let resolvedViaServers = viaServers;
    if (isRoomAlias(roomIdOrAlias) && !viaServers?.length) {
      const resolution = await mx.getRoomIdForAlias(roomIdOrAlias);
      summaryTarget = resolution.room_id;
      resolvedViaServers = resolution.servers;
      aliasResolutionRef.current = {
        alias: roomIdOrAlias,
        roomId: resolution.room_id,
        viaServers: resolution.servers,
      };
    }

    return {
      summary: await mx.getRoomSummary(summaryTarget, resolvedViaServers),
      viaServers: resolvedViaServers,
    };
  }, [mx, roomIdOrAlias, viaServers]);

  const { data, error, refetch } = useQuery({
    queryKey: [roomIdOrAlias, `summary`, viaServers],
    queryFn: fetchSummary,
  });

  let state: AsyncState<IRoomSummary, Error> = { status: AsyncStatus.Loading };
  if (error) {
    state = { status: AsyncStatus.Error, error };
  } else if (data) {
    state = { status: AsyncStatus.Success, data: data.summary };
  }

  const aliasResolution =
    !viaServers?.length && aliasResolutionRef.current?.alias === roomIdOrAlias
      ? aliasResolutionRef.current
      : undefined;
  const resolvedRoomId =
    data?.summary.room_id ?? (isRoomId(roomIdOrAlias) ? roomIdOrAlias : aliasResolution?.roomId);

  return children(
    state,
    () => void refetch(),
    data?.viaServers ?? aliasResolution?.viaServers ?? viaServers,
    resolvedRoomId
  );
}

export function LocalRoomSummaryLoader({
  room,
  children,
}: {
  room: Room;
  children: (roomSummary: LocalRoomSummary) => ReactNode;
}) {
  const summary = useLocalRoomSummary(room);

  return children(summary);
}

export function HierarchyRoomSummaryLoader({
  roomId,
  children,
}: {
  roomId: string;
  children: (state: AsyncState<IHierarchyRoom, Error>) => ReactNode;
}) {
  const mx = useMatrixClient();

  const fetchSummary = useCallback(() => mx.getRoomHierarchy(roomId, 1, 1), [mx, roomId]);
  const [errorMemo, setError] = useState<Error>();

  const { data, error } = useQuery({
    queryKey: [roomId, `hierarchy`],
    queryFn: fetchSummary,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, err) => {
      setError(err);
      if (failureCount > 3) return false;
      return true;
    },
  });

  let state: AsyncState<IHierarchyRoom, Error> = {
    status: AsyncStatus.Loading,
  };
  if (error) {
    state = {
      status: AsyncStatus.Error,
      error,
    };
  }
  if (errorMemo) {
    state = {
      status: AsyncStatus.Error,
      error: errorMemo,
    };
  }

  const summary = data?.rooms[0] ?? undefined;
  if (summary) {
    state = {
      status: AsyncStatus.Success,
      data: summary,
    };
  }

  return children(state);
}
