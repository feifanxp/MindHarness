import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { isZeroReplyStandaloneThreadRootEvent } from './compactThreadRootData';
import { isPendingLocalEchoThreadRootEvent } from './threadRouteUtils';
import { getValidThreadRootEvent } from './threadUtils';

export const getResolvableThreadRootEvent = (
  room: Pick<Room, 'findEventById' | 'getThread'>,
  threadRootId?: string
): MatrixEvent | undefined => {
  const sdkThreadRoot = getValidThreadRootEvent(room, threadRootId);
  if (sdkThreadRoot) return sdkThreadRoot;
  if (!threadRootId) return undefined;

  const candidateRoot = room.findEventById(threadRootId);
  if (!candidateRoot || candidateRoot.getId() !== threadRootId) {
    return undefined;
  }

  if (isPendingLocalEchoThreadRootEvent(candidateRoot)) {
    return undefined;
  }

  return isZeroReplyStandaloneThreadRootEvent(candidateRoot) ? candidateRoot : undefined;
};
