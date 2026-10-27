import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ClientEvent,
  Direction,
  EventType,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { createSessionId } from '../../state/sessions';
import { isRecord } from '../../utils/isRecord';
import { isEventOrderedAfter } from '../../utils/room';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import {
  CHAT_UI_ACTION_KEY,
  readCanvasEdit,
  readCanvasVersion,
  readChatUiAction,
} from '../ui-actions/chatUiProtocol';
import {
  type CanvasListEntry,
  forgetCanvas,
  hasCanvases,
  isComputerShown,
  listCanvases,
  recordCanvas,
  recordCanvasUpdate,
  recordComputerShown,
  replaceDeletedVersion,
  subscribeCanvasList,
} from './canvasIndexStore';

export const canvasSessionId = (mx: MatrixClient): string =>
  createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());

/**
 * Lists a canvas made for this user, applies an update of a listed one, forgets a deleted one, or
 * notes a conversation where an agent showed the computer; other events are ignored. Updates and
 * deletions can arrive long after their canvas left memory, where no timeline takes them, so they
 * are applied to the listed entry.
 */
export const recordCanvasEvent = (
  mx: MatrixClient,
  event: MatrixEvent
): Promise<void> | undefined => {
  const sender = event.getSender();
  const eventId = event.getId();
  if (!sender || !eventId?.startsWith('$')) return undefined;
  // Only deletions that may be of a canvas reach the store: agents delete a reaction after every reply.
  const maybeCanvas = (deleted: MatrixEvent) =>
    deleted.getType() === EventType.RoomMessage &&
    isMindroomAgentUserIdForViewer(deleted.getSender() ?? '', mx.getSafeUserId());
  // A canvas can also turn up already deleted, in history loaded after a missed deletion.
  if (event.isRedacted()) return maybeCanvas(event) ? forgetDeleted(mx, eventId) : undefined;
  if (event.isRedaction()) {
    const redacted = event.event.redacts ?? event.getContent().redacts;
    if (typeof redacted !== 'string') return undefined;
    const target = mx.getRoom(event.getRoomId())?.findEventById(redacted);
    return !target || maybeCanvas(target) ? forgetDeleted(mx, redacted) : undefined;
  }
  const content = event.getOriginalContent<Record<string, unknown>>();
  const relation = event.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const newContent = content['m.new_content'];
    // Only canvas updates reach the store; agents stream many other edits.
    if (!relation.event_id || !isRecord(newContent) || !isRecord(newContent[CHAT_UI_ACTION_KEY])) {
      return undefined;
    }
    // The panel's rule for an update, held against the authority the listed request carries.
    return recordCanvasUpdate(canvasSessionId(mx), relation.event_id, event.getTs(), (known) => {
      const version = readCanvasEdit(event, known.agentUserId, {
        version: 1,
        action: 'show_canvas',
        requester_id: mx.getSafeUserId(),
        agent_user_id: known.agentUserId,
        room_id: known.roomId,
        thread_id: known.threadId ?? null,
        ...(known.shared ? { share_state: true } : {}),
      });
      return version && { title: version.canvas.title, revisionId: version.revisionEventId };
    });
  }
  const data = content[CHAT_UI_ACTION_KEY];
  if (!isRecord(data)) return undefined;
  if (data.action === 'show_computer') {
    const room = mx.getRoom(event.getRoomId());
    const action = room ? readChatUiAction(event, mx.getSafeUserId(), room) : undefined;
    return room && action?.action === 'show_computer'
      ? recordComputerShown(canvasSessionId(mx), room.roomId, action.threadId)
      : undefined;
  }
  const entry = readCanvasEntry(mx, event);
  return entry && recordCanvas(canvasSessionId(mx), entry);
};

/** The row for a canvas request made for this user, at the version it shows. */
const readCanvasEntry = (mx: MatrixClient, event: MatrixEvent): CanvasListEntry | undefined => {
  const room = mx.getRoom(event.getRoomId());
  const action = room ? readChatUiAction(event, mx.getSafeUserId(), room) : undefined;
  if (!room || action?.action !== 'show_canvas') return undefined;
  const shown = action.revisionEventId === action.eventId ? event : event.replacingEvent();
  return {
    canvasId: action.eventId,
    roomId: room.roomId,
    ...(action.threadId ? { threadId: action.threadId } : {}),
    agentUserId: action.agentUserId,
    title: action.canvas.title,
    revisionId: action.revisionEventId,
    createdTs: event.getTs(),
    updatedTs: shown?.getTs() ?? event.getTs(),
    shared: !!action.shareState,
  };
};

/**
 * A deleted canvas leaves the list; a deleted update that a row shows falls back to the canvas's
 * surviving version (Element can remove one version from a message's edit history).
 */
const forgetDeleted = async (mx: MatrixClient, deletedId: string): Promise<void> => {
  const sessionId = canvasSessionId(mx);
  await forgetCanvas(sessionId, deletedId);
  const shown = (await listCanvases(sessionId)).find((entry) => entry.revisionId === deletedId);
  const room = shown && mx.getRoom(shown.roomId);
  const canvas = room ? await loadCanvasEvent(mx, room, shown.canvasId) : undefined;
  const entry = canvas && readCanvasEntry(mx, canvas);
  // Only while the row still shows the deleted version: a newer update or a deletion may have
  // come in while the canvas loaded.
  if (entry) await replaceDeletedVersion(sessionId, deletedId, entry);
};

/**
 * Reads the index now and again after each burst of writes: sync can write many entries at once.
 * A failed read keeps the last value; returns the stop function.
 */
export const watchCanvasIndex = <T>(
  read: () => Promise<T>,
  onValue: (value: T) => void
): (() => void) => {
  let alive = true;
  let timer: number | undefined;
  const load = () => {
    read().then(
      (value) => {
        if (alive) onValue(value);
      },
      () => undefined
    );
  };
  load();
  const unsubscribe = subscribeCanvasList(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(load, 100);
  });
  return () => {
    alive = false;
    window.clearTimeout(timer);
    unsubscribe();
  };
};

const NO_CANVASES: CanvasListEntry[] = [];

/** The one key rules for a conversation (`threadId` undefined: the room's main timeline). */
const conversationKey = (sessionId: string, roomId: string, threadId: string | undefined) =>
  `${sessionId}\n${roomId}\n${threadId ?? ''}`;

/**
 * What the index says about one conversation, read again after each burst of writes. Another
 * conversation's answer is not this one's while the read is on its way, and an answer equal to the
 * one held changes nothing, so a write elsewhere in the index does not render the room again.
 * `read` and `same` must be module-level functions.
 */
function useConversationIndex<T>(
  mx: MatrixClient,
  roomId: string,
  threadId: string | undefined,
  read: (sessionId: string, roomId: string, threadId: string | undefined) => Promise<T>,
  same: (held: T, read: T) => boolean,
  fallback: T
): T {
  const sessionId = canvasSessionId(mx);
  const key = conversationKey(sessionId, roomId, threadId);
  const [found, setFound] = useState<{ key: string; value: T }>();
  useEffect(
    () =>
      watchCanvasIndex(
        () => read(sessionId, roomId, threadId),
        (value) =>
          setFound((held) => (held?.key === key && same(held.value, value) ? held : { key, value }))
      ),
    [key, sessionId, roomId, threadId, read, same]
  );
  return found?.key === key ? found.value : fallback;
}

const readConversationCanvases = async (
  sessionId: string,
  roomId: string,
  threadId: string | undefined
): Promise<CanvasListEntry[]> =>
  (await listCanvases(sessionId))
    .filter((entry) => entry.roomId === roomId && entry.threadId === threadId)
    .sort((a, b) => b.updatedTs - a.updatedTs);

// Only what the header shows decides whether a list changed.
const sameCanvases = (held: CanvasListEntry[], read: CanvasListEntry[]): boolean =>
  held.length === read.length &&
  held.every(
    (entry, index) =>
      entry.canvasId === read[index].canvasId &&
      entry.revisionId === read[index].revisionId &&
      entry.updatedTs === read[index].updatedTs &&
      entry.title === read[index].title
  );

/** This conversation's canvases (`threadId` undefined: the room's main timeline), newest update first. */
export function useConversationCanvases(
  mx: MatrixClient,
  roomId: string,
  threadId: string | undefined
): CanvasListEntry[] {
  return useConversationIndex(
    mx,
    roomId,
    threadId,
    readConversationCanvases,
    sameCanvases,
    NO_CANVASES
  );
}

const readComputerShown = (sessionId: string, roomId: string, threadId: string | undefined) =>
  isComputerShown(sessionId, roomId, threadId);

const sameBoolean = (held: boolean, read: boolean): boolean => held === read;

/** Whether an agent showed the computer in this conversation. */
export function useComputerShown(
  mx: MatrixClient,
  roomId: string,
  threadId: string | undefined
): boolean {
  return useConversationIndex(mx, roomId, threadId, readComputerShown, sameBoolean, false);
}

// The last answer per session: a remounted sidebar starts from it instead of popping the button in.
const listedBySession = new Map<string, boolean>();

/** Whether this session lists any canvas, kept current as the list changes. */
export function useHasListedCanvases(mx: MatrixClient): boolean {
  const sessionId = canvasSessionId(mx);
  const [listed, setListed] = useState<{ sessionId: string; value: boolean }>();
  useEffect(
    () =>
      watchCanvasIndex(
        async () => {
          const value = await hasCanvases(sessionId);
          listedBySession.set(sessionId, value);
          return value;
        },
        (value) =>
          setListed((held) =>
            held?.sessionId === sessionId && held.value === value ? held : { sessionId, value }
          )
      ),
    [sessionId]
  );
  return listed?.sessionId === sessionId ? listed.value : listedBySession.get(sessionId) ?? false;
}

/**
 * Keeps the Canvases page's list current with every canvas this client sees, and notes the
 * conversations where an agent showed its computer, on any route. Runs while canvases or computers are on.
 */
export function useCanvasIndexRecorder(mx: MatrixClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onEvent = (event: MatrixEvent) => {
      recordCanvasEvent(mx, event)?.catch(() => undefined);
    };
    // Canvases loaded before this started (the cached sync) are in the timelines already.
    mx.getRooms().forEach((room) => {
      room.getLiveTimeline().getEvents().forEach(onEvent);
      room.getThreads().forEach((thread) => thread.events.forEach(onEvent));
    });
    // Sync reports every event, also one about a canvas whose thread is not loaded, which no
    // timeline takes; timelines add the events loaded later (history, threads opened).
    mx.on(ClientEvent.Event, onEvent);
    mx.on(RoomEvent.Timeline, onEvent);
    mx.on(MatrixEventEvent.Decrypted, onEvent);
    mx.on(MatrixEventEvent.Replaced, onEvent);
    return () => {
      mx.off(ClientEvent.Event, onEvent);
      mx.off(RoomEvent.Timeline, onEvent);
      mx.off(MatrixEventEvent.Decrypted, onEvent);
      mx.off(MatrixEventEvent.Replaced, onEvent);
    };
  }, [mx, enabled]);
}

/**
 * A canvas request by ID: the loaded copy, or else the server's with its newest valid update
 * applied, so a canvas from long ago still opens at its latest version.
 */
export const loadCanvasEvent = async (
  mx: MatrixClient,
  room: Room,
  canvasId: string
): Promise<MatrixEvent | undefined> => {
  const loaded = room.findEventById(canvasId);
  if (loaded) return loaded;
  try {
    // The SDK decrypts both in encrypted rooms and drops edits by anyone but the request's sender.
    const { originalEvent, events } = await mx.relations(
      room.roomId,
      canvasId,
      RelationType.Replace,
      EventType.RoomMessage,
      { dir: Direction.Backward, limit: 50 }
    );
    if (!originalEvent) return undefined;
    const newest = events
      .filter((edit) => readCanvasVersion(originalEvent, edit))
      .reduce<MatrixEvent | undefined>(
        (latest, edit) => (!latest || isEventOrderedAfter(edit, latest) ? edit : latest),
        undefined
      );
    if (newest) originalEvent.makeReplaced(newest);
    return originalEvent;
  } catch {
    return undefined;
  }
};

/**
 * Opens a listed canvas from the header. Its request may have to be fetched or be gone by now
 * (deleted, and then nothing opens), so a user action made meanwhile wins over the late answer:
 * it is dropped when `context` changed (the caller puts the conversation and the side-panel state
 * in it: another canvas, the computer or Members opened, the canvas closed), when the room left,
 * and when a later choice superseded it. `activate` acts on what is shown now.
 */
export function useOpenCanvasById(
  mx: MatrixClient,
  room: Room,
  context: string,
  activate: (event: MatrixEvent) => void
): (canvasId: string) => void {
  const latestActivate = useRef(activate);
  useLayoutEffect(() => {
    latestActivate.current = activate;
  }, [activate]);
  const choice = useRef(0);
  // A layout effect, so the answer is dropped from the commit of the change on, not a task later.
  useLayoutEffect(
    () => () => {
      choice.current += 1;
    },
    [mx, room, context]
  );
  return useCallback(
    (canvasId: string) => {
      choice.current += 1;
      const mine = choice.current;
      loadCanvasEvent(mx, room, canvasId).then((event) => {
        if (event && choice.current === mine) latestActivate.current(event);
      });
    },
    [mx, room]
  );
}
