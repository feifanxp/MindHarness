import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MatrixEvent, MatrixEventEvent, Room, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { enqueueThreadApprovalBackfill, useMindroomSyncEngine } from '../engine';
import { useLiveEventArrive } from '../threads/roomLiveEventArrive';
import { collectKnownRedactedEventIds } from '../threads/eventRevision';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  isUndecryptedApprovalCandidate,
  MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
  parseToolApprovalExpiryTimestamp,
} from './toolApproval';
import {
  ApprovalAction,
  ApprovalActionState,
  ApprovalResponseContent,
  isApprovalPending,
} from './approvalActions';
import { useApprovalActions } from './useApprovalActions';
import { hydrateThreadApprovalEvents, mergeThreadApprovalEvents } from './threadApprovalEvents';
import { collectThreadApprovals, ThreadApprovalRecord } from './threadApprovalModel';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

export type ThreadApprovals = {
  roomId: string;
  threadId: string;
  records: readonly ThreadApprovalRecord[];
  now: number;
  pendingEventIds: ReadonlySet<string>;
  loading: boolean;
  error?: string;
  refresh: () => void;
  ingestTimeline: (events: readonly MatrixEvent[]) => void;
  actions: ReadonlyMap<string, ApprovalActionState>;
  submit: (record: ThreadApprovalRecord, action: ApprovalAction) => Promise<void>;
  focusConversation?: () => void;
};
const Context = createContext<ThreadApprovals | undefined>(undefined);
export const useThreadApprovals = () => useContext(Context);

export function ThreadApprovalProvider({
  room,
  threadId,
  children,
  focusConversation,
}: {
  room: Room;
  threadId?: string;
  children: React.ReactNode;
  focusConversation?: () => void;
}) {
  return threadId ? (
    <ActiveThreadApprovalProvider
      key={`${room.roomId}:${threadId}`}
      room={room}
      threadId={threadId}
      focusConversation={focusConversation}
    >
      {children}
    </ActiveThreadApprovalProvider>
  ) : (
    <>{children}</>
  );
}

function ActiveThreadApprovalProvider({
  room,
  threadId,
  children,
  focusConversation,
}: {
  room: Room;
  threadId: string;
  children: React.ReactNode;
  focusConversation?: () => void;
}) {
  const mx = useMatrixClient();
  const ignoredUsers = useIgnoredUsers();
  const { scheduler, persist } = useMindroomSyncEngine();
  const timelineEvents = useRef<readonly MatrixEvent[]>([]);
  const [history, setHistory] = useState(() =>
    mergeThreadApprovalEvents(
      { events: new Map(), scopedEventIds: new Set() },
      [...room.getLiveTimeline().getEvents(), ...(room.getThread(threadId)?.events ?? [])],
      room.roomId,
      threadId
    )
  );
  const events = history.events;
  const [loading, setLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [repairError, setRepairError] = useState<string>();
  const [request, setRequest] = useState<{ revision: number; origins?: MatrixEvent[] }>({
    revision: 0,
  });
  const [now, setNow] = useState(Date.now);
  const fetching = useRef(false);
  const repairedOrigins = useRef(new Set<string>());
  const decryptionStarted = useRef(new WeakSet<MatrixEvent>());
  const viewerId = mx.getUserId() ?? undefined;
  // Only MindRoom sends approval cards; any member can post this event type.
  const records = useMemo(
    () =>
      collectThreadApprovals([...events.values()], room.roomId, threadId, now).filter(
        (record) =>
          isMindroomAgentUserIdForViewer(record.sender, viewerId) &&
          !ignoredUsers.includes(record.sender)
      ),
    [events, room.roomId, threadId, now, ignoredUsers, viewerId]
  );
  // Missing-key failures resolve in the SDK. Retained events own completeness,
  // so late keys and targeted repairs cannot leave a stale or premature success.
  const unreadableHistory = useMemo(() => {
    const retained = [...events.values()];
    const redacted = collectKnownRedactedEventIds(
      room,
      retained.map((event) => event.event)
    );
    return retained.some(
      (event) =>
        !redacted.has(event.getId() ?? '') &&
        !ignoredUsers.includes(event.getSender() ?? '') &&
        isUndecryptedApprovalCandidate(event)
    );
  }, [events, ignoredUsers, room]);
  const error =
    discoveryError ??
    repairError ??
    (unreadableHistory ? 'Some approval history could not be decrypted.' : undefined);
  const retainedEventsRef = useRef(events);
  useLayoutEffect(() => {
    retainedEventsRef.current = events;
  }, [events]);
  const send = useCallback(
    (content: ApprovalResponseContent) =>
      mx.sendEvent(room.roomId, MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT as any, content),
    [mx, room.roomId]
  );
  const { actions, submit } = useApprovalActions(records, threadId, now, send);
  const pendingEventIds = useMemo(
    () =>
      new Set(
        records
          .filter((record) => isApprovalPending(record, actions.get(record.eventId), now))
          .map((record) => record.eventId)
      ),
    [records, actions, now]
  );
  const refresh = useCallback(() => setRequest(({ revision }) => ({ revision: revision + 1 })), []);
  const ingest = useCallback(
    (incoming: readonly MatrixEvent[], fromBackfill = false) => {
      setHistory((old) =>
        mergeThreadApprovalEvents(old, incoming, room.roomId, threadId, fromBackfill)
      );
    },
    [room.roomId, threadId]
  );
  const ingestTimeline = useCallback(
    (incoming: readonly MatrixEvent[]) => {
      timelineEvents.current = incoming;
      ingest(incoming);
    },
    [ingest]
  );
  useEffect(() => {
    const repaired = hydrateThreadApprovalEvents(room, history, timelineEvents.current);
    if (repaired.length > 0) persist.persistThreadEventCache(room, threadId, repaired);
  }, [room, threadId, history, persist]);
  useLiveEventArrive(
    room,
    useCallback((event) => ingest([event]), [ingest])
  );
  const decrypted = useCallback((event: MatrixEvent) => ingest([event]), [ingest]);
  useEffect(() => {
    const scan = () =>
      ingest([...room.getLiveTimeline().getEvents(), ...(room.getThread(threadId)?.events ?? [])]);
    // The SDK emits these once per event it adds to a thread, and a scan copies
    // the whole room timeline and thread, so a burst gets one scan per task.
    let queuedScan: ReturnType<typeof setTimeout> | undefined;
    const queueScan = () => {
      queuedScan ??= setTimeout(() => {
        queuedScan = undefined;
        scan();
      }, 0);
    };
    const changed = (event: MatrixEvent) => {
      ingest([event]);
      queueScan();
    };
    scan();
    room.on(ThreadEvent.New, queueScan);
    room.on(ThreadEvent.Update, queueScan);
    room.on(ThreadEvent.NewReply, queueScan);
    room.on(RoomEvent.TimelineRefresh, refresh);
    mx.on(MatrixEventEvent.Decrypted, decrypted);
    mx.on(MatrixEventEvent.Replaced, changed);
    return () => {
      clearTimeout(queuedScan);
      room.off(ThreadEvent.New, queueScan);
      room.off(ThreadEvent.Update, queueScan);
      room.off(ThreadEvent.NewReply, queueScan);
      room.off(RoomEvent.TimelineRefresh, refresh);
      mx.off(MatrixEventEvent.Decrypted, decrypted);
      mx.off(MatrixEventEvent.Replaced, changed);
    };
  }, [mx, room, threadId, ingest, refresh, decrypted]);
  useEffect(() => {
    const retained = [...events.values()];
    retained.forEach((event) => {
      event.on(MatrixEventEvent.Decrypted, decrypted);
      if (isUndecryptedApprovalCandidate(event) && !decryptionStarted.current.has(event)) {
        decryptionStarted.current.add(event);
        // Bundled edits have no SDK mapper to start decryption. Retention keeps
        // failures visible and subscribed while the SDK waits for room keys.
        void mx.decryptEventIfNeeded(event).catch(() => undefined);
      }
    });
    return () => {
      retained.forEach((event) => event.off(MatrixEventEvent.Decrypted, decrypted));
    };
  }, [mx, events, decrypted]);
  useEffect(() => {
    let active = true;
    const setRequestError = request.origins ? setRepairError : setDiscoveryError;
    fetching.current = true;
    setLoading(true);
    void enqueueThreadApprovalBackfill(mx, scheduler, room.roomId, threadId, request.origins, [
      ...retainedEventsRef.current.values(),
    ])
      .then((result) => {
        if (!active) return;
        fetching.current = false;
        result.repairedEventIds.forEach((id) => {
          repairedOrigins.current.add(id);
        });
        ingest(result.events, true);
        setRequestError(result.error);
        // Only complete discovery also proves that earlier repair failures recovered.
        if (!request.origins && !result.error) setRepairError(undefined);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          fetching.current = false;
          setRequestError('Approval history could not be loaded.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      scheduler.abort(room.roomId, threadId, 'thread-approvals');
    };
  }, [mx, scheduler, room.roomId, threadId, request, ingest]);
  useEffect(() => {
    const origins = [...events]
      .filter(
        ([id, event]) =>
          !repairedOrigins.current.has(id) &&
          !event.isRedacted() &&
          event.getType() === MINDROOM_TOOL_APPROVAL_EVENT &&
          event.getOriginalContent().thread_id === threadId &&
          event.getRelation()?.rel_type !== 'm.replace'
      )
      .map(([, event]) => event);
    if (!fetching.current && !repairError && origins.length > 0)
      setRequest(({ revision }) => ({ revision: revision + 1, origins }));
  }, [events, loading, threadId, repairError]);
  useEffect(() => {
    const deadlines = records.flatMap(({ approval }) => {
      const expiry =
        approval.status === 'pending'
          ? parseToolApprovalExpiryTimestamp(approval.expiresAt)
          : approval.autoApproval && !approval.autoApproval.revokedAt
          ? parseToolApprovalExpiryTimestamp(approval.autoApproval.expiresAt)
          : undefined;
      if (expiry === undefined || expiry <= now) return [];
      return [approval.status === 'pending' ? expiry : now + ((expiry - now) % 60_000 || 60_000)];
    });
    if (deadlines.length === 0) return undefined;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [records, now]);
  const value = useMemo(
    () => ({
      roomId: room.roomId,
      threadId,
      records,
      now,
      pendingEventIds,
      loading,
      error,
      refresh,
      ingestTimeline,
      actions,
      submit,
      focusConversation,
    }),
    [
      room.roomId,
      threadId,
      records,
      now,
      pendingEventIds,
      loading,
      error,
      refresh,
      ingestTimeline,
      actions,
      submit,
      focusConversation,
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
