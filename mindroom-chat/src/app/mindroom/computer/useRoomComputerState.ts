import { useCallback, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ComputerInteraction } from './ComputerPanel';

type Conversation = {
  mx: MatrixClient;
  roomId: string;
  threadId?: string;
  available: boolean;
  apiUrl?: string;
};

type ComputerView = {
  open: boolean;
  requestedAgent?: { userId: string };
  interaction: ComputerInteraction;
};

const closedView = (): ComputerView => ({ open: false, interaction: { locked: false } });

/** Room controls own the view; the panel remains the owner of its computer session. */
export function useRoomComputerState(conversation: Conversation) {
  const [stored, setStored] = useState(() => ({ conversation, view: closedView() }));
  let current = stored;
  if (
    stored.conversation.mx !== conversation.mx ||
    stored.conversation.roomId !== conversation.roomId ||
    stored.conversation.threadId !== conversation.threadId ||
    stored.conversation.available !== conversation.available ||
    stored.conversation.apiUrl !== conversation.apiUrl
  ) {
    current = { conversation, view: closedView() };
    // Reset before children render, so a previous view never starts a session in the new route.
    setStored(current);
  }

  const owner = current.conversation;
  const update = useCallback(
    (change: (view: ComputerView) => ComputerView) => {
      setStored((previous) =>
        previous.conversation === owner
          ? { conversation: owner, view: change(previous.view) }
          : previous
      );
    },
    [owner]
  );
  const toggle = useCallback(
    () => update((view) => ({ ...closedView(), open: !view.open && owner.available })),
    [owner, update]
  );
  const show = useCallback(
    (userId: string) =>
      update((view) => ({
        ...view,
        open: owner.available,
        requestedAgent: { userId },
      })),
    [owner, update]
  );
  const close = useCallback(() => update(closedView), [update]);
  const reportInteraction = useCallback(
    (interaction: ComputerInteraction) => update((view) => ({ ...view, interaction })),
    [update]
  );

  return { ...current.view, toggle, show, close, reportInteraction };
}
