import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { listenForChatUiActions } from './chatUiController';
import { type ChatUiAction, readChatUiAction } from './chatUiProtocol';

type ChatUiActions = {
  read: (event: MatrixEvent) => ChatUiAction | undefined;
  activate: (event: MatrixEvent) => void;
  unavailable: (action: ChatUiAction) => string | undefined;
};

export const ChatUiActionContext = createContext<ChatUiActions | undefined>(undefined);

export type ChatUiActionOptions = {
  mx: MatrixClient;
  room: Room;
  threadId?: string;
  autoOpenFromHomeservers?: readonly string[];
  ready: boolean;
  perform: (action: ChatUiAction) => void;
  unavailable: (action: ChatUiAction) => string | undefined;
  navigate: (threadId?: string) => void;
};

export function useChatUiActions({
  mx,
  room,
  threadId,
  autoOpenFromHomeservers,
  ready,
  perform,
  unavailable,
  navigate,
}: ChatUiActionOptions): ChatUiActions {
  const [pending, setPending] = useState<{ event: MatrixEvent; clickedAt: number }>();
  const latest = useRef({ perform, unavailable });
  useLayoutEffect(() => {
    latest.current = { perform, unavailable };
  }, [perform, unavailable]);
  const read = useCallback(
    (event: MatrixEvent) => readChatUiAction(event, mx.getSafeUserId(), room),
    [mx, room]
  );
  const activate = useCallback(
    (event: MatrixEvent) => {
      const action = read(event);
      if (!action || latest.current.unavailable(action)) return;
      if (action.threadId === threadId && ready) {
        latest.current.perform(action);
      } else {
        setPending({ event, clickedAt: Date.now() });
        navigate(action.threadId);
      }
    },
    [navigate, read, ready, threadId]
  );

  useEffect(() => {
    if (!pending) return;
    const action = read(pending.event);
    if (!action || Date.now() - pending.clickedAt > 10_000) {
      setPending(undefined);
      return;
    }
    if (!ready || action.threadId !== threadId) return;
    setPending(undefined);
    if (!latest.current.unavailable(action)) latest.current.perform(action);
  }, [pending, read, ready, threadId]);

  useEffect(() => {
    if (!ready) return undefined;
    return listenForChatUiActions({
      mx,
      room,
      threadId,
      autoOpenFromHomeservers,
      isForeground: () => document.visibilityState === 'visible' && document.hasFocus(),
      onAction: (action) => {
        if (!latest.current.unavailable(action)) latest.current.perform(action);
      },
    });
  }, [mx, room, threadId, ready, autoOpenFromHomeservers]);

  return useMemo(() => ({ read, activate, unavailable }), [read, activate, unavailable]);
}
