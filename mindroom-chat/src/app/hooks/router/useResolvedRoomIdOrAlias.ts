import { useEffect, useState } from 'react';
import { useMatrixClient } from '../useMatrixClient';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';

const resolveKnownRoomId = (
  mx: ReturnType<typeof useMatrixClient>,
  roomIdOrAlias: string | undefined
): string | undefined => {
  if (!roomIdOrAlias) return undefined;
  if (!isRoomAlias(roomIdOrAlias)) return roomIdOrAlias;
  return getCanonicalAliasRoomId(mx, roomIdOrAlias);
};

type AsyncRoomResolution = {
  isResolving: boolean;
  roomId?: string;
  roomIdOrAlias: string;
};

export const useResolvedRoomIdOrAlias = (roomIdOrAlias: string | undefined) => {
  const mx = useMatrixClient();
  const knownRoomId = resolveKnownRoomId(mx, roomIdOrAlias);
  const [asyncResolution, setAsyncResolution] = useState<AsyncRoomResolution>();
  const currentAsyncResolution =
    asyncResolution?.roomIdOrAlias === roomIdOrAlias ? asyncResolution : undefined;
  const resolvedRoomId = knownRoomId ?? currentAsyncResolution?.roomId;
  const isResolvingAlias =
    !!roomIdOrAlias &&
    isRoomAlias(roomIdOrAlias) &&
    !knownRoomId &&
    (currentAsyncResolution?.isResolving ?? true);

  useEffect(() => {
    if (!roomIdOrAlias) {
      setAsyncResolution((currentResolution) => (currentResolution ? undefined : currentResolution));
      return;
    }

    if (!isRoomAlias(roomIdOrAlias) || knownRoomId) {
      setAsyncResolution((currentResolution) => (currentResolution ? undefined : currentResolution));
      return;
    }

    let disposed = false;
    setAsyncResolution({
      isResolving: true,
      roomId: undefined,
      roomIdOrAlias,
    });

    mx.getRoomIdForAlias(roomIdOrAlias)
      .then((aliasResponse) => {
        if (disposed) return;
        setAsyncResolution({
          isResolving: false,
          roomId: aliasResponse.room_id,
          roomIdOrAlias,
        });
      })
      .catch(() => {
        if (disposed) return;
        setAsyncResolution({
          isResolving: false,
          roomId: undefined,
          roomIdOrAlias,
        });
      });

    return () => {
      disposed = true;
    };
  }, [knownRoomId, mx, roomIdOrAlias]);

  return {
    roomId: resolvedRoomId,
    isResolvingAlias,
  };
};
