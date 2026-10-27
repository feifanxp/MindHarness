import { useCallback, useState } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';

type Conversation = {
  mx: MatrixClient;
  roomId: string;
  threadId?: string;
};

/** The room owns which canvas request is open; a route change closes it before children render. */
export function useRoomCanvasState(conversation: Conversation) {
  const [stored, setStored] = useState<{ conversation: Conversation; event?: MatrixEvent }>(() => ({
    conversation,
  }));
  let current = stored;
  if (
    stored.conversation.mx !== conversation.mx ||
    stored.conversation.roomId !== conversation.roomId ||
    stored.conversation.threadId !== conversation.threadId
  ) {
    current = { conversation };
    setStored(current);
  }

  const owner = current.conversation;
  const show = useCallback(
    (event: MatrixEvent) =>
      setStored((previous) =>
        previous.conversation === owner ? { conversation: owner, event } : previous
      ),
    [owner]
  );
  const close = useCallback(
    () =>
      setStored((previous) =>
        previous.conversation === owner && previous.event ? { conversation: owner } : previous
      ),
    [owner]
  );

  return { event: current.event, show, close };
}
