import {
  type EventTimelineSetHandlerMap,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  type Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { CHAT_UI_ACTION_KEY, type ChatUiAction, readChatUiAction } from './chatUiProtocol';
import { getMxIdServer } from '../../utils/matrix';

const LIVE_WINDOW_MS = 60_000;
// Survives room remounts, but cannot leak action identity between Matrix clients/accounts.
const observedByClient = new WeakMap<MatrixClient, Map<string, number>>();

export type ChatUiListenerOptions = {
  mx: MatrixClient;
  room: Room;
  threadId?: string;
  autoOpenFromHomeservers?: readonly string[];
  onAction: (action: ChatUiAction) => void;
  isForeground: () => boolean;
  now?: () => number;
};

/** Only live delivery can request automatic UI changes; message rendering stays passive. */
export const listenForChatUiActions = ({
  mx,
  room,
  threadId,
  autoOpenFromHomeservers,
  onAction,
  isForeground,
  now = Date.now,
}: ChatUiListenerOptions): (() => void) => {
  const startedAt = now();
  let active = true;
  const pending = new Map<string, MatrixEvent>();
  let observed = observedByClient.get(mx);
  if (!observed) {
    observed = new Map();
    observedByClient.set(mx, observed);
  }
  const seen = observed;
  const fresh = (event: MatrixEvent) => {
    const timestamp = event.getTs();
    const current = now();
    return (
      Number.isFinite(timestamp) &&
      timestamp >= startedAt &&
      timestamp <= current &&
      current - timestamp <= LIVE_WINDOW_MS
    );
  };
  const ready = () =>
    active &&
    isForeground() &&
    mx.isInitialSyncComplete() &&
    mx.getSyncState() === SyncState.Syncing;
  const deliver = (event: MatrixEvent) => {
    if (!ready() || !fresh(event)) return;
    const action = readChatUiAction(event, mx.getSafeUserId(), room);
    if (!action || action.threadId !== threadId) return;
    const senderServer = getMxIdServer(action.agentUserId);
    if (
      senderServer &&
      Array.isArray(autoOpenFromHomeservers) &&
      autoOpenFromHomeservers.includes(senderServer)
    ) {
      onAction(action);
    }
  };
  const decrypted = (event: MatrixEvent) => {
    const id = event.getId();
    if (
      !id ||
      pending.get(id) !== event ||
      event.getType() === 'm.room.encrypted' ||
      event.isDecryptionFailure()
    )
      return;
    pending.delete(id);
    deliver(event);
  };
  const timeline: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
    event,
    eventRoom,
    toStart,
    removed,
    data
  ) => {
    const id = event.getId();
    if (!active || eventRoom?.roomId !== room.roomId || !id || removed) return;
    const encrypted = event.isEncrypted();
    if (!encrypted && !event.getOriginalContent()[CHAT_UI_ACTION_KEY]) return;

    const cutoff = now() - LIVE_WINDOW_MS;
    seen.forEach((timestamp, key) => {
      if (timestamp < cutoff) seen.delete(key);
    });
    pending.forEach((candidate, key) => {
      if (!fresh(candidate)) pending.delete(key);
    });
    if (seen.has(id)) return;
    seen.set(id, now());
    if (data?.liveEvent !== true || toStart || !ready() || !fresh(event)) return;
    if (!encrypted) {
      deliver(event);
      return;
    }
    pending.set(id, event);
    // A key may arrive later. The Decrypted subscription only accepts these live candidates.
    void mx
      .decryptEventIfNeeded(event)
      .then(() => decrypted(event))
      .catch(() => undefined);
  };

  mx.on(RoomEvent.Timeline, timeline);
  mx.on(MatrixEventEvent.Decrypted, decrypted);
  return () => {
    active = false;
    pending.clear();
    mx.removeListener(RoomEvent.Timeline, timeline);
    mx.removeListener(MatrixEventEvent.Decrypted, decrypted);
  };
};
